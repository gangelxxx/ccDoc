import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Helper: load builtin script ──────────────────────────────────────────

const BUILTIN_DIR = join(__dirname, "..", "main", "services", "provider-scripts", "builtin");

function loadScript(name: string): any {
  const code = readFileSync(join(BUILTIN_DIR, `${name}.js`), "utf-8");
  const exports: any = {};
  const module = { exports };
  const sandbox = {
    module, exports, Object, Array, JSON, Promise, Date, Math,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    require: undefined, process: undefined,
    __dirname: undefined, __filename: undefined,
    global: undefined, globalThis: undefined,
  };
  vm.runInNewContext(code, sandbox, { timeout: 5000 });
  return module.exports;
}

/** Create a mock ProviderContext */
function mockCtx(overrides?: Partial<any>): any {
  return {
    apiKey: "sk-test-key",
    baseUrl: "https://api.example.com",
    model: "test-model",
    homedir: "/home/test",
    fetch: vi.fn(),
    readFile: vi.fn().mockReturnValue(null),
    log: vi.fn(),
    ...overrides,
  };
}

/** Create minimal chat params */
function mockParams(overrides?: Partial<any>): any {
  return {
    messages: [{ role: "user", content: "Hello" }],
    system: "You are a test assistant.",
    tools: [],
    maxTokens: 1024,
    temperature: 0.5,
    thinking: false,
    thinkingBudget: 0,
    stream: false,
    skipMessageCache: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// anthropic-oauth.js
// ═══════════════════════════════════════════════════════════════════════════

describe("anthropic-oauth.js", () => {
  let script: any;

  beforeEach(() => {
    script = loadScript("anthropic-oauth");
  });

  it("exports meta with correct id", () => {
    expect(script.meta.id).toBe("anthropic-oauth");
    expect(script.meta.name).toContain("Anthropic");
  });

  it("exports chat and listModels functions", () => {
    expect(typeof script.chat).toBe("function");
    expect(typeof script.listModels).toBe("function");
  });

  describe("chat()", () => {
    it("sends Bearer authorization header", async () => {
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({}) }),
      });
      await script.chat(ctx, mockParams());
      const [url, init] = ctx.fetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/messages");
      expect(init.headers.authorization).toBe("Bearer sk-test-key");
    });

    it("includes anthropic-beta with oauth flags", async () => {
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      const headers = ctx.fetch.mock.calls[0][1].headers;
      expect(headers["anthropic-beta"]).toContain("oauth-2025-04-20");
      expect(headers["anthropic-beta"]).toContain("prompt-caching-2024-07-31");
      expect(headers["anthropic-beta"]).toContain("claude-code-20250219");
    });

    it("includes Claude Code Identity in system prompt", async () => {
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
      expect(body.system[0].text).toContain("Claude Code");
    });

    it("applies prompt caching on system block", async () => {
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
      expect(body.system[1].cache_control).toEqual({ type: "ephemeral" });
    });

    it("applies cache_control on last tool", async () => {
      const tools = [
        { name: "t1", description: "d1", input_schema: {} },
        { name: "t2", description: "d2", input_schema: {} },
      ];
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams({ tools }));
      const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
      expect(body.tools[0].cache_control).toBeUndefined();
      expect(body.tools[1].cache_control).toEqual({ type: "ephemeral" });
    });

    it("includes thinking when enabled", async () => {
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams({ thinking: true, thinkingBudget: 8000 }));
      const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    });

    it("reads OAuth token from credentials file", async () => {
      const ctx = mockCtx({
        apiKey: "fallback-key",
        readFile: vi.fn().mockReturnValue(JSON.stringify({
          claudeAiOauth: { accessToken: "fresh-oauth-token" },
        })),
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      const headers = ctx.fetch.mock.calls[0][1].headers;
      expect(headers.authorization).toBe("Bearer fresh-oauth-token");
    });

    it("falls back to apiKey when credentials file missing", async () => {
      const ctx = mockCtx({
        apiKey: "my-api-key",
        readFile: vi.fn().mockReturnValue(null),
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      const headers = ctx.fetch.mock.calls[0][1].headers;
      expect(headers.authorization).toBe("Bearer my-api-key");
    });

    it("retries without cache on 400", async () => {
      const ctx = mockCtx({
        fetch: vi.fn()
          .mockResolvedValueOnce({ status: 400, ok: false })
          .mockResolvedValueOnce({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      expect(ctx.fetch).toHaveBeenCalledTimes(2);
      // Second call should not have prompt-caching in beta
      const headers2 = ctx.fetch.mock.calls[1][1].headers;
      expect(headers2["anthropic-beta"]).not.toContain("prompt-caching");
    });

    it("refreshes token on 401", async () => {
      let callCount = 0;
      const ctx = mockCtx({
        apiKey: "initial",
        readFile: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount > 1
            ? JSON.stringify({ claudeAiOauth: { accessToken: "refreshed-token" } })
            : null;
        }),
        fetch: vi.fn()
          .mockResolvedValueOnce({ status: 401, ok: false })
          .mockResolvedValueOnce({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      expect(ctx.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("retries on 429 with backoff", { timeout: 15000 }, async () => {
      const ctx = mockCtx({
        fetch: vi.fn()
          .mockResolvedValueOnce({ status: 429, ok: false })
          .mockResolvedValueOnce({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      expect(ctx.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(ctx.log).toHaveBeenCalledWith("warn", expect.stringContaining("429"));
    });

    it("retries on 500 with backoff", { timeout: 10000 }, async () => {
      const ctx = mockCtx({
        fetch: vi.fn()
          .mockResolvedValueOnce({ status: 500, ok: false })
          .mockResolvedValueOnce({ status: 200, ok: true }),
      });
      await script.chat(ctx, mockParams());
      expect(ctx.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("listModels()", () => {
    it("fetches from /v1/models with Bearer auth", async () => {
      const ctx = mockCtx({
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ id: "m1", display_name: "Model 1" }], has_more: false }),
        }),
      });
      const models = await script.listModels(ctx);
      expect(models).toEqual([{ id: "m1", name: "Model 1" }]);
      const [url] = ctx.fetch.mock.calls[0];
      expect(url).toContain("/v1/models");
    });

    it("handles pagination", async () => {
      const ctx = mockCtx({
        fetch: vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ id: "m1", display_name: "M1" }], has_more: true, last_id: "m1" }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ id: "m2", display_name: "M2" }], has_more: false }),
          }),
      });
      const models = await script.listModels(ctx);
      expect(models).toHaveLength(2);
      expect(models[1].id).toBe("m2");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// anthropic-apikey.js
// ═══════════════════════════════════════════════════════════════════════════

describe("anthropic-apikey.js", () => {
  let script: any;

  beforeEach(() => {
    script = loadScript("anthropic-apikey");
  });

  it("exports meta with correct id", () => {
    expect(script.meta.id).toBe("anthropic-apikey");
  });

  it("uses x-api-key header (not Bearer)", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const headers = ctx.fetch.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("sk-test-key");
    expect(headers.authorization).toBeUndefined();
  });

  it("does NOT include Claude Code Identity in system", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    // System should be an array with only one block (no Identity)
    if (Array.isArray(body.system)) {
      expect(body.system.length).toBe(1);
      expect(body.system[0].text).not.toContain("Claude Code");
    }
  });

  it("includes prompt-caching beta flag", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const headers = ctx.fetch.mock.calls[0][1].headers;
    expect(headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
  });

  it("removes beta on 400 fallback", async () => {
    const ctx = mockCtx({
      fetch: vi.fn()
        .mockResolvedValueOnce({ status: 400, ok: false })
        .mockResolvedValueOnce({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const headers2 = ctx.fetch.mock.calls[1][1].headers;
    expect(headers2["anthropic-beta"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// openai.js
// ═══════════════════════════════════════════════════════════════════════════

describe("openai.js", () => {
  let script: any;

  beforeEach(() => {
    script = loadScript("openai");
  });

  it("exports meta with correct id", () => {
    expect(script.meta.id).toBe("openai");
  });

  it("sends to /chat/completions with Bearer auth", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const [url, init] = ctx.fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test-key");
  });

  it("maps Anthropic tools to OpenAI function format", async () => {
    const tools = [
      { name: "get_time", description: "Get current time", input_schema: { type: "object", properties: {} } },
    ];
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams({ tools }));
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "get_time", description: "Get current time", parameters: { type: "object", properties: {} } },
    });
  });

  it("prepends system message to messages array", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams({ system: "Be helpful." }));
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("fetches models from /models", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-3.5-turbo" }] }),
      }),
    });
    const models = await script.listModels(ctx);
    expect(models).toEqual([
      { id: "gpt-4o", name: "gpt-4o" },
      { id: "gpt-3.5-turbo", name: "gpt-3.5-turbo" },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ollama.js
// ═══════════════════════════════════════════════════════════════════════════

describe("ollama.js", () => {
  let script: any;

  beforeEach(() => {
    script = loadScript("ollama");
  });

  it("exports meta with correct id", () => {
    expect(script.meta.id).toBe("ollama");
  });

  it("sends to /api/chat without authorization", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const [url, init] = ctx.fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/chat");
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers["x-api-key"]).toBeUndefined();
  });

  it("sets stream: false in body", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
  });

  it("fetches models from /api/tags", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "llama3:latest" }, { name: "mistral" }] }),
      }),
    });
    const models = await script.listModels(ctx);
    expect(models).toEqual([
      { id: "llama3:latest", name: "llama3:latest" },
      { id: "mistral", name: "mistral" },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// openrouter.js
// ═══════════════════════════════════════════════════════════════════════════

describe("openrouter.js", () => {
  let script: any;

  beforeEach(() => {
    script = loadScript("openrouter");
  });

  it("exports meta with correct id", () => {
    expect(script.meta.id).toBe("openrouter");
    expect(script.meta.name).toBe("OpenRouter");
  });

  it("sends to /chat/completions with Bearer auth", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const [url, init] = ctx.fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test-key");
  });

  it("includes OpenRouter-specific headers (referer, title)", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    const headers = ctx.fetch.mock.calls[0][1].headers;
    expect(headers["http-referer"]).toBe("https://ccdoc.app");
    expect(headers["x-openrouter-title"]).toBe("ccDoc");
  });

  it("maps Anthropic tools to OpenAI function format", async () => {
    const tools = [
      { name: "search", description: "Search docs", input_schema: { type: "object", properties: { q: { type: "string" } } } },
    ];
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams({ tools }));
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.tools[0]).toEqual({
      type: "function",
      function: {
        name: "search",
        description: "Search docs",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    });
  });

  it("includes reasoning field when thinking is enabled", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams({ thinking: true, thinkingBudget: 8000 }));
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ max_tokens: 8000 });
  });

  it("does NOT include reasoning when thinking is disabled", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams({ thinking: false }));
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.reasoning).toBeUndefined();
  });

  it("does not retry on 402 (credits exhausted)", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 402, ok: false }),
    });
    const res = await script.chat(ctx, mockParams());
    expect(res.status).toBe(402);
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
    expect(ctx.log).toHaveBeenCalledWith("error", expect.stringContaining("402"));
  });

  it("retries on 429", { timeout: 15000 }, async () => {
    const ctx = mockCtx({
      fetch: vi.fn()
        .mockResolvedValueOnce({ status: 429, ok: false })
        .mockResolvedValueOnce({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams());
    expect(ctx.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("prepends system message", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true }),
    });
    await script.chat(ctx, mockParams({ system: "You help with docs." }));
    const body = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "You help with docs." });
  });

  it("fetches models from /models with names", async () => {
    const ctx = mockCtx({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
            { id: "openai/gpt-4o", name: "GPT-4o" },
            { id: "meta-llama/llama-3-8b" },
          ],
        }),
      }),
    });
    const models = await script.listModels(ctx);
    expect(models).toEqual([
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
      { id: "meta-llama/llama-3-8b", name: "meta-llama/llama-3-8b" },
    ]);
  });
});
