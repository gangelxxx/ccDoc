import { app, ipcMain } from "electron";
import { join } from "path";
import { mkdirSync, writeFileSync, writeFile, readFileSync, existsSync } from "fs";
import { computeBackoff, sleep } from "../utils/backoff";
import { classifyApiError, isRetryable, getRetryPolicy, getMaxRetries } from "../utils/error-classify";
import { rateLimiter } from "../utils/rate-limiter";
import { ScriptRunner } from "../services/provider-scripts/script-runner.js";
import type { ModelTierConfig, ProviderScriptRef } from "../services/settings.types.js";
import type { ChatParams } from "../services/provider-scripts/types.js";

// ─── OAuth token cache with TTL ───────────────────────────────

let cachedOAuthToken: string | null = null;
let cachedOAuthAt = 0;
const OAUTH_TTL = 30_000; // 30 seconds

/** Read fresh OAuth token from Claude CLI credentials, cached with TTL */
function getFreshOAuthToken(): string | null {
  const now = Date.now();
  if (cachedOAuthToken && now - cachedOAuthAt < OAUTH_TTL) return cachedOAuthToken;
  try {
    const credPath = join(app.getPath("home"), ".claude", ".credentials.json");
    if (!existsSync(credPath)) return null;
    const creds = JSON.parse(readFileSync(credPath, "utf-8"));
    const token = creds?.claudeAiOauth?.accessToken;
    if (token) {
      cachedOAuthToken = token;
      cachedOAuthAt = now;
    }
    return token || null;
  } catch { return null; }
}

function invalidateOAuthCache() {
  cachedOAuthToken = null;
  cachedOAuthAt = 0;
}

export function registerLlmIpc(): void {
  const logsDir = join(app.getPath("userData"), "logs", "prompts");
  mkdirSync(logsDir, { recursive: true });
  const feedbackDir = join(app.getPath("userData"), "logs", "feedback");
  mkdirSync(feedbackDir, { recursive: true });
  let llmCallCounter = 0;

  ipcMain.handle("logs:saveFeedback", async (_e, data: string) => {
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const { writeFile } = await import("fs/promises");
    await writeFile(join(feedbackDir, filename), data, "utf-8");
  });

  // ─── Abort support: track AbortControllers for all in-flight requests ───
  const activeControllers = new Map<number, AbortController>();

  ipcMain.handle("llm:abort", () => {
    if (activeControllers.size === 0) return;
    console.log(`[llm:abort] Aborting ${activeControllers.size} active LLM request(s)`);
    for (const [id, ctrl] of activeControllers) {
      console.log(`[llm:abort] Aborting #${id}`);
      ctrl.abort();
    }
    activeControllers.clear();
  });

  ipcMain.handle("llm:setup-token", async () => {
    // Read OAuth token from Claude CLI credentials
    const homedir = app.getPath("home");
    const credPath = join(homedir, ".claude", ".credentials.json");
    try {
      if (!existsSync(credPath)) {
        return { ok: false, error: "Claude CLI credentials not found. Run 'claude login' in terminal first." };
      }
      const creds = JSON.parse(readFileSync(credPath, "utf-8"));
      const token = creds?.claudeAiOauth?.accessToken;
      if (!token) {
        return { ok: false, error: "No OAuth token in Claude CLI credentials." };
      }
      return { ok: true, key: token };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("llm:models", async (_e, apiKey: string) => {
    const isOAuth = apiKey.startsWith("sk-ant-oat");
    let effectiveApiKey = apiKey;
    if (isOAuth) {
      const fresh = getFreshOAuthToken();
      if (fresh) effectiveApiKey = fresh;
    }
    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
    };
    if (isOAuth) {
      headers["authorization"] = `Bearer ${effectiveApiKey}`;
      headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31";
    } else {
      headers["x-api-key"] = effectiveApiKey;
    }

    const allModels: { id: string; display_name: string }[] = [];
    let afterId: string | undefined;

    for (;;) {
      const url = new URL("https://api.anthropic.com/v1/models");
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);

      console.log("[llm:models] fetching", url.toString());
      let res = await fetch(url.toString(), { headers });
      // OAuth token refresh: on 401, try once with a fresh token
      if (!res.ok && res.status === 401 && isOAuth) {
        invalidateOAuthCache();
        const refreshed = getFreshOAuthToken();
        if (refreshed && refreshed !== effectiveApiKey) {
          effectiveApiKey = refreshed;
          headers["authorization"] = `Bearer ${refreshed}`;
          res = await fetch(url.toString(), { headers });
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        console.error("[llm:models] error:", res.status, err);
        throw new Error(`[${res.status}] ${err?.error?.message || res.statusText}`);
      }
      const body = await res.json();
      console.log("[llm:models] got", body.data?.length, "models, has_more:", body.has_more);
      for (const m of body.data ?? []) {
        allModels.push({ id: m.id, display_name: m.display_name });
      }
      if (!body.has_more) break;
      afterId = body.last_id;
    }

    console.log("[llm:models] total:", allModels.length);
    return allModels;
  });

  ipcMain.handle("llm:chat", async (_e, params: { apiKey: string; system: string; messages: any[]; model: string; maxTokens: number; tools?: any[]; thinking?: { type: string; budget_tokens: number }; temperature?: number; skipMessageCache?: boolean; toolChoice?: { type: string } }) => {
    const { system, messages, model, maxTokens, tools, thinking, temperature, skipMessageCache, toolChoice } = params;
    const isOAuth = params.apiKey.startsWith("sk-ant-oat");

    // For OAuth: always use fresh token from Claude CLI credentials
    let effectiveApiKey = params.apiKey;
    if (isOAuth) {
      const fresh = getFreshOAuthToken();
      if (fresh) effectiveApiKey = fresh;
    }

    const keyPreview = effectiveApiKey.length > 12 ? `${effectiveApiKey.slice(0, 8)}...${effectiveApiKey.slice(-4)}` : "***";
    const callId = ++llmCallCounter;

    // Register abort controller for this request
    const abortController = new AbortController();
    activeControllers.set(callId, abortController);
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const prefix = `${date}_${time}_${callId}`;

    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
    if (isOAuth) {
      headers["authorization"] = `Bearer ${effectiveApiKey}`;
      headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31";
      headers["user-agent"] = "claude-cli/2.1.76";
      headers["x-app"] = "cli";
    } else {
      headers["x-api-key"] = effectiveApiKey;
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }

    // OAuth requires Claude Code identity as first system block
    const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

    // --- Build request body WITH prompt caching ---
    function buildBody(useCache: boolean): Record<string, any> {
      let sys: any;
      if (useCache) {
        const blocks = [];
        if (isOAuth) blocks.push({ type: "text", text: CLAUDE_CODE_IDENTITY });
        blocks.push({ type: "text", text: system, cache_control: { type: "ephemeral" } });
        sys = blocks;
      } else {
        if (isOAuth) {
          sys = [{ type: "text", text: CLAUDE_CODE_IDENTITY }, { type: "text", text: system }];
        } else {
          sys = system;
        }
      }

      const cachedTools = useCache && tools?.length
        ? tools.map((t: any, i: number) =>
            i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
          )
        : tools;

      let msgs = messages;
      if (useCache && !skipMessageCache) {
        // Sliding cache checkpoint: cache second-to-last user message to cover accumulated tool results.
        // Anthropic allows up to 4 ephemeral breakpoints: system, tools, msgs[0], msgs[slidingIdx].
        // Use a search loop (not messages.length - 3) to handle consecutive user messages,
        // e.g. sub-agent last-round injects "write report" user message after tool_results,
        // breaking the alternating pattern so the index formula would point to an assistant message.
        let slidingIdx = -1;
        if (messages.length >= 4) {
          let userCount = 0;
          for (let i = messages.length - 1; i >= 1; i--) {
            if ((messages[i] as any).role === "user") {
              userCount++;
              if (userCount === 2) { slidingIdx = i; break; }
            }
          }
        }

        msgs = messages.map((m: any, i: number) => {
          if (i === 0 && m.role === "user") {
            if (typeof m.content === "string") {
              return { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] };
            } else if (Array.isArray(m.content)) {
              const blocks = [...m.content];
              for (let j = blocks.length - 1; j >= 0; j--) {
                if (blocks[j].type === "text") {
                  blocks[j] = { ...blocks[j], cache_control: { type: "ephemeral" } };
                  break;
                }
              }
              return { ...m, content: blocks };
            }
          }
          // Sliding checkpoint: cache last block of second-to-last user message
          if (i === slidingIdx && m.role === "user" && Array.isArray(m.content) && m.content.length > 0) {
            const blocks = [...m.content];
            blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
            return { ...m, content: blocks };
          }
          return m;
        });
      }

      const body: Record<string, any> = { model, max_tokens: maxTokens, system: sys, messages: msgs };
      if (cachedTools?.length) body.tools = cachedTools;
      if (thinking) body.thinking = thinking;
      if (toolChoice) body.tool_choice = toolChoice;
      if (temperature !== undefined && !thinking) body.temperature = temperature;
      return body;
    }

    async function doRequest(body: Record<string, any>, label: string): Promise<Response> {
      const bodyStr = JSON.stringify(body, null, 2);
      writeFile(join(logsDir, `${prefix}_request_${label}.json`), bodyStr, "utf-8", () => {});
      // Sanitize lone Unicode surrogates: JSON spec forbids them, Anthropic returns 400
      // High surrogate \uD800-\uDBFF not followed by low \uDC00-\uDFFF → replace with U+FFFD
      // Low surrogate \uDC00-\uDFFF not preceded by high → replace with U+FFFD
      const safeBody = bodyStr
        .replace(/\\u[dD][89aAbB][0-9a-fA-F]{2}(?!\\u[dD][cCdDeEfF][0-9a-fA-F]{2})/g, "\\ufffd")
        .replace(/(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, "\\ufffd");
      return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers, body: safeBody,
        signal: abortController.signal,
      });
    }

    /** Network-level errors (timeout, DNS, connection refused) — retry with backoff */
    const networkPolicy = { initialMs: 2000, maxMs: 15000, factor: 2, jitter: 0.3 };
    const networkMaxRetries = 3;

    async function doRequestThrottled(body: Record<string, any>, label: string): Promise<Response> {
      await rateLimiter.waitIfNeeded();
      for (let attempt = 0; attempt <= networkMaxRetries; attempt++) {
        try {
          const res = await doRequest(body, attempt === 0 ? label : `${label}_net_retry${attempt}`);
          rateLimiter.updateFromHeaders(res.headers);
          return res;
        } catch (err: any) {
          // Abort errors should not be retried — propagate immediately
          if (err.name === "AbortError" || abortController.signal.aborted) throw err;
          if (attempt < networkMaxRetries) {
            const delayMs = computeBackoff(networkPolicy, attempt + 1);
            console.warn(
              `[llm:chat] #${callId} network error: ${err?.cause?.code || err.message}, ` +
              `retry ${attempt + 1}/${networkMaxRetries} in ${delayMs}ms`
            );
            await sleep(delayMs, abortController.signal);
          } else {
            throw err;
          }
        }
      }
      throw new Error("unreachable");
    }

    /** Extract human-readable message from API error response (handles HTML from Cloudflare) */
    function parseErrorMessage(status: number, text: string): string {
      // Try JSON first
      try {
        const json = JSON.parse(text);
        if (json?.error?.message) return json.error.message;
      } catch { /* not JSON */ }
      // Cloudflare HTML — extract title
      const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) return titleMatch[1].trim();
      // Fallback
      return text.length > 200 ? `HTTP ${status}: Server error` : text;
    }

    // Try with caching first, fallback to plain on 400
    console.log(`[llm:chat] #${callId} key=${keyPreview} isOAuth=${isOAuth} model=${model}`);
    try {
      let useCache = true;
      let res = await doRequestThrottled(buildBody(true), "cached");

      if (res.status === 400) {
        const errText = await res.text().catch(() => "");
        console.warn(`[llm:chat] #${callId} cached request failed (400), retrying without cache_control...`, errText);
        writeFileSync(join(logsDir, `${prefix}_error_cached.json`), errText, "utf-8");

        // Remove cache beta and retry without cache_control
        useCache = false;
        if (isOAuth) {
          headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14";
        } else {
          delete headers["anthropic-beta"];
        }
        res = await doRequestThrottled(buildBody(false), "plain");
      }

      // Unified retry loop with exponential backoff + jitter
      // Track last error text to avoid re-reading consumed response body
      let lastErrText = "";

      if (!res.ok) {
        lastErrText = await res.text().catch(() => "");
        let category = classifyApiError(res.status, lastErrText);
        const errMsg = parseErrorMessage(res.status, lastErrText);

        // OAuth token refresh: on auth error, try once with a fresh token from Claude CLI
        if (isOAuth && category === "auth") {
          invalidateOAuthCache();
          const refreshed = getFreshOAuthToken();
          if (refreshed && refreshed !== effectiveApiKey) {
            effectiveApiKey = refreshed;
            headers["authorization"] = `Bearer ${refreshed}`;
            console.log(`[llm:chat] #${callId} OAuth token refreshed, retrying`);
            writeFileSync(join(logsDir, `${prefix}_error_auth_refresh.json`), lastErrText, "utf-8");
            res = await doRequestThrottled(buildBody(useCache), "oauth_refresh");
            if (!res.ok) {
              lastErrText = await res.text().catch(() => "");
              category = classifyApiError(res.status, lastErrText);
            }
          }
        }

        if (res.ok) {
          // OAuth refresh succeeded — skip retry loop
        } else if (isRetryable(category)) {
          let currentPolicy = getRetryPolicy(category);
          const maxRetries = getMaxRetries(category);
          writeFileSync(join(logsDir, `${prefix}_error_${category}.json`), lastErrText, "utf-8");

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // For 429: retry-after header takes priority over computed backoff
            const retryAfterMs = rateLimiter.getRetryAfterMs(res.headers);
            const backoffMs = computeBackoff(currentPolicy, attempt);
            const delayMs = Math.max(backoffMs, retryAfterMs);

            console.warn(
              `[llm:chat] #${callId} ${category} (${res.status}: ${errMsg}), ` +
              `retry ${attempt}/${maxRetries} in ${delayMs}ms` +
              (retryAfterMs ? ` (retry-after: ${retryAfterMs}ms)` : "")
            );

            await sleep(delayMs, abortController.signal);
            res = await doRequestThrottled(buildBody(useCache), `${category}_retry${attempt}`);
            if (res.ok) break;

            // Re-classify — error may have changed between retries
            lastErrText = await res.text().catch(() => "");
            const newCategory = classifyApiError(res.status, lastErrText);
            writeFileSync(join(logsDir, `${prefix}_error_${newCategory}_retry${attempt}.json`), lastErrText, "utf-8");
            if (!isRetryable(newCategory)) break;
            // Update backoff policy if error category changed (e.g. server_error → rate_limit)
            if (newCategory !== category) {
              currentPolicy = getRetryPolicy(newCategory);
            }
          }
        } else {
          // Non-retryable (auth, bad_request, unknown) — detailed log for diagnostics
          console.error(`[llm:chat] #${callId} non-retryable: ${category} (${res.status}: ${errMsg}) key=${keyPreview}`);
          writeFileSync(join(logsDir, `${prefix}_error_${category}_final.json`), lastErrText, "utf-8");
        }
      }

      if (!res.ok) {
        // Use saved error text (body already consumed), fallback to statusText
        const errText = lastErrText || res.statusText;
        const msg = parseErrorMessage(res.status, errText);
        writeFileSync(join(logsDir, `${prefix}_error.json`), errText, "utf-8");
        console.error(`[llm:chat] #${callId} ERROR ${res.status}:`, msg);
        throw new Error(`[${res.status}] ${msg}`);
      }

      const data = await res.json();
      writeFileSync(join(logsDir, `${prefix}_response.json`), JSON.stringify(data, null, 2), "utf-8");

      console.log("[llm:chat] #" + callId, "stop_reason:", data.stop_reason, "usage:", data.usage);
      for (const block of data.content || []) {
        if (block.type === "tool_use") {
          console.log("[llm:chat] #" + callId, "tool_use:", block.name, "input:", JSON.stringify(block.input).slice(0, 500));
        } else if (block.type === "text") {
          console.log("[llm:chat] #" + callId, "text:", block.text?.slice(0, 200));
        }
      }
      return data;
    } finally {
      activeControllers.delete(callId);
    }
  });

  // ─── Provider Script based channels ──────────────────────────

  const scriptRunner = new ScriptRunner();

  /** Chat via ModelTierConfig (used by tier-based engine) */
  ipcMain.handle("llm:tier-chat", async (_e, params: {
    tierConfig: ModelTierConfig;
    system: string;
    messages: any[];
    tools?: any[];
    thinking?: { type: string; budget_tokens: number };
    temperature?: number;
    skipMessageCache?: boolean;
    toolChoice?: { type: string };
  }) => {
    const { tierConfig, system, messages, tools, thinking, temperature, skipMessageCache, toolChoice } = params;
    const callId = ++llmCallCounter;
    const abortController = new AbortController();
    activeControllers.set(callId, abortController);

    const now = new Date();
    const prefix = `${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 8).replace(/:/g, "-")}_${callId}`;

    try {
      const chatParams: ChatParams = {
        messages,
        system,
        tools,
        maxTokens: tierConfig.maxTokens,
        temperature: temperature ?? tierConfig.temperature,
        thinking: !!thinking,
        thinkingBudget: thinking?.budget_tokens ?? tierConfig.thinkingBudget,
        stream: false,
        signal: abortController.signal,
        skipMessageCache,
        toolChoice,
      };

      console.log(`[llm:tier-chat] #${callId} script=${tierConfig.providerScript.type}:${tierConfig.providerScript.builtinId || "custom"} model=${tierConfig.modelId}`);

      const RETRY_STATUSES = new Set([429, 500, 502, 503, 529]);
      const RETRY_DELAYS = [3000, 8000, 20000];
      let lastRes: Response | null = null;

      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1];
          console.warn(`[llm:tier-chat] #${callId} retry ${attempt}/${RETRY_DELAYS.length} in ${delay}ms`);
          await sleep(delay, abortController.signal);
        }

        lastRes = await scriptRunner.chat(tierConfig, chatParams);

        if (lastRes.ok) break;
        if (!RETRY_STATUSES.has(lastRes.status)) break; // non-retryable (400, 401, 403)
        if (attempt < RETRY_DELAYS.length) {
          const errText = await lastRes.text().catch(() => "");
          writeFileSync(join(logsDir, `${prefix}_tier_error_attempt${attempt}.json`), errText, "utf-8");
          console.warn(`[llm:tier-chat] #${callId} ${lastRes.status} — will retry`);
        }
      }

      const res = lastRes!;

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        writeFileSync(join(logsDir, `${prefix}_tier_error.json`), errText, "utf-8");
        let msg = errText;
        try {
          const json = JSON.parse(errText);
          if (json?.error?.message) msg = json.error.message;
        } catch { /* not JSON */ }
        const titleMatch = msg.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) msg = titleMatch[1].trim();
        if (msg.length > 200) msg = `HTTP ${res.status}: Server error`;
        throw new Error(`[${res.status}] ${msg}`);
      }

      let data = await res.json();
      writeFileSync(join(logsDir, `${prefix}_tier_response.json`), JSON.stringify(data, null, 2), "utf-8");

      // OpenRouter sometimes returns HTTP 200 with error in body
      if (data.error && !data.choices && !data.content) {
        const errCode = data.error.code || 500;
        // Retry if it's a server error
        if (RETRY_STATUSES.has(errCode)) {
          for (let retry = 0; retry < RETRY_DELAYS.length; retry++) {
            const delay = RETRY_DELAYS[retry];
            console.warn(`[llm:tier-chat] #${callId} body error ${errCode}, retry ${retry + 1}/${RETRY_DELAYS.length} in ${delay}ms`);
            writeFileSync(join(logsDir, `${prefix}_tier_bodyerr_attempt${retry}.json`), JSON.stringify(data, null, 2), "utf-8");
            await sleep(delay, abortController.signal);
            const retryRes = await scriptRunner.chat(tierConfig, chatParams);
            if (!retryRes.ok) continue;
            data = await retryRes.json();
            if (!data.error || data.choices || data.content) break; // success
          }
        }
        // Still an error after retries
        if (data.error && !data.choices && !data.content) {
          throw new Error(`[${data.error.code || 500}] ${data.error.message || "Provider error"}`);
        }
      }

      console.log("[llm:tier-chat] #" + callId, "stop_reason:", data.stop_reason, "usage:", data.usage);
      return data;
    } finally {
      activeControllers.delete(callId);
    }
  });

  /** List models for a tier config */
  ipcMain.handle("llm:tier-list-models", async (_e, tierConfig: ModelTierConfig) => {
    return scriptRunner.listModels(tierConfig);
  });

  /** Get script metadata */
  ipcMain.handle("llm:script-meta", async (_e, ref: ProviderScriptRef) => {
    return scriptRunner.getMeta(ref);
  });

  /** Get script source code (for viewer) */
  ipcMain.handle("llm:script-code", async (_e, ref: ProviderScriptRef) => {
    return scriptRunner.getCode(ref);
  });

  /** List all builtin scripts */
  ipcMain.handle("llm:builtin-scripts", async () => {
    return scriptRunner.listBuiltinScripts();
  });

  /** Invalidate script cache */
  ipcMain.handle("llm:invalidate-script", async (_e, ref: ProviderScriptRef) => {
    scriptRunner.invalidate(ref);
  });

  /** Test model connection (used by model test service) */
  ipcMain.handle("llm:test-model", async (_e, tierConfig: ModelTierConfig) => {
    const { testModel } = await import("../services/llm-test.service.js");
    return testModel(tierConfig, scriptRunner);
  });

  /** Test a single stage (for progressive UI updates) */
  ipcMain.handle("llm:test-stage", async (_e, tierConfig: ModelTierConfig, stage: string) => {
    const { testStage } = await import("../services/llm-test.service.js");
    return testStage(tierConfig, stage as any, scriptRunner);
  });
}
