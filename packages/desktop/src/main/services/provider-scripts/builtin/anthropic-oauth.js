// providers/anthropic-oauth.js
// Anthropic via OAuth token from Claude CLI (~/.claude/.credentials.json)
// Full logic: headers, Identity, prompt caching, 401-retry with invalidation, rate limiter

const meta = {
  id: "anthropic-oauth",
  name: "Anthropic (OAuth / Claude CLI)",
  description: "Claude via OAuth token from ~/.claude/.credentials.json",
};
module.exports.meta = meta;

// ─── OAuth token cache ───
let cached = { token: null, at: 0 };
const TTL = 30000; // 30 seconds

function getFreshToken(ctx) {
  if (cached.token && Date.now() - cached.at < TTL) return cached.token;
  var raw = ctx.readFile(ctx.homedir, ".claude", ".credentials.json");
  if (!raw) return ctx.apiKey;
  try {
    var token = JSON.parse(raw).claudeAiOauth.accessToken;
    if (token) { cached = { token: token, at: Date.now() }; }
    return token || ctx.apiKey;
  } catch (e) { return ctx.apiKey; }
}

function invalidateCache() {
  cached = { token: null, at: 0 };
}

// ─── Rate Limiter ───
var lastRequestAt = 0;
var MIN_INTERVAL = 500;

function waitIfNeeded() {
  var now = Date.now();
  var elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL) {
    return new Promise(function(r) { setTimeout(r, MIN_INTERVAL - elapsed); });
  }
  lastRequestAt = Date.now();
  return Promise.resolve();
}

// ─── Main method ───
module.exports.chat = async function chat(ctx, params) {
  var token = getFreshToken(ctx);

  // 1. Headers
  var headers = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "authorization": "Bearer " + token,
    "anthropic-beta": [
      "claude-code-20250219",
      "oauth-2025-04-20",
      "interleaved-thinking-2025-05-14",
      "prompt-caching-2024-07-31",
    ].join(","),
    "user-agent": "claude-cli/2.1.76",
    "x-app": "cli",
  };

  // 2. Claude Code Identity + System prompt with caching
  var IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
  var systemBlocks = [
    { type: "text", text: IDENTITY },
    { type: "text", text: params.system, cache_control: { type: "ephemeral" } },
  ];

  // 3. Tools with caching (on last tool)
  var tools = params.tools || [];
  if (tools.length > 0) {
    tools = tools.map(function(t, i) {
      return i === tools.length - 1
        ? Object.assign({}, t, { cache_control: { type: "ephemeral" } })
        : t;
    });
  }

  // 4. Messages with caching (sliding window)
  var messages = params.messages;
  if (!params.skipMessageCache && messages.length > 0) {
    // Find sliding checkpoint: second-to-last user message
    var slidingIdx = -1;
    if (messages.length >= 4) {
      var userCount = 0;
      for (var i = messages.length - 1; i >= 1; i--) {
        if (messages[i].role === "user") {
          userCount++;
          if (userCount === 2) { slidingIdx = i; break; }
        }
      }
    }

    messages = messages.map(function(m, i) {
      // Cache first user message
      if (i === 0 && m.role === "user") {
        if (typeof m.content === "string") {
          return Object.assign({}, m, {
            content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }]
          });
        } else if (Array.isArray(m.content)) {
          var blocks = m.content.slice();
          for (var j = blocks.length - 1; j >= 0; j--) {
            if (blocks[j].type === "text") {
              blocks[j] = Object.assign({}, blocks[j], { cache_control: { type: "ephemeral" } });
              break;
            }
          }
          return Object.assign({}, m, { content: blocks });
        }
      }
      // Cache second-to-last user message (sliding checkpoint)
      if (i === slidingIdx && m.role === "user" && Array.isArray(m.content) && m.content.length > 0) {
        var blocks2 = m.content.slice();
        blocks2[blocks2.length - 1] = Object.assign({}, blocks2[blocks2.length - 1], { cache_control: { type: "ephemeral" } });
        return Object.assign({}, m, { content: blocks2 });
      }
      return m;
    });
  }

  // 5. Body
  var body = {
    model: ctx.model,
    max_tokens: params.maxTokens,
    system: systemBlocks,
    messages: messages,
  };
  if (tools.length > 0) body.tools = tools;
  if (params.thinking) {
    body.thinking = { type: "enabled", budget_tokens: params.thinkingBudget };
  }
  if (params.toolChoice) body.tool_choice = params.toolChoice;
  if (params.temperature !== undefined && !params.thinking) {
    body.temperature = params.temperature;
  }

  // Sanitize lone surrogates
  var bodyStr = JSON.stringify(body);
  bodyStr = bodyStr
    .replace(/\\u[dD][89aAbB][0-9a-fA-F]{2}(?!\\u[dD][cCdDeEfF][0-9a-fA-F]{2})/g, "\\ufffd")
    .replace(/(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, "\\ufffd");

  // 6. Send with rate limiting
  await waitIfNeeded();
  lastRequestAt = Date.now();
  var res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
    method: "POST",
    headers: headers,
    body: bodyStr,
    signal: params.signal,
  });

  // 7. Fallback: 400 → remove prompt caching
  if (res.status === 400) {
    ctx.log("warn", "400 — retrying without prompt caching");
    headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14";
    body.system = [
      { type: "text", text: IDENTITY },
      { type: "text", text: params.system },
    ];
    body.tools = (params.tools || []);
    body.messages = params.messages;
    bodyStr = JSON.stringify(body);
    await waitIfNeeded();
    lastRequestAt = Date.now();
    res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
      method: "POST", headers: headers, body: bodyStr, signal: params.signal,
    });
  }

  // 8. Auth error: 401 → re-read token, retry
  if (res.status === 401) {
    ctx.log("warn", "401 — invalidating OAuth cache, retrying");
    invalidateCache();
    var newToken = getFreshToken(ctx);
    if (newToken !== token) {
      headers["authorization"] = "Bearer " + newToken;
      await waitIfNeeded();
      lastRequestAt = Date.now();
      res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
        method: "POST", headers: headers, body: bodyStr, signal: params.signal,
      });
    }
  }

  // 9. Rate limit / overloaded / server error → exponential backoff
  if (res.status === 429 || res.status === 529 || res.status >= 500) {
    var maxRetries = res.status === 429 ? 5 : 3;
    var delay = res.status === 429 ? 5000 : 2000;
    for (var r = 0; r < maxRetries; r++) {
      ctx.log("warn", res.status + " — retry " + (r + 1) + "/" + maxRetries + " after " + delay + "ms");
      await new Promise(function(resolve) { setTimeout(resolve, delay + Math.random() * delay * 0.2); });
      lastRequestAt = Date.now();
      res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
        method: "POST", headers: headers, body: bodyStr, signal: params.signal,
      });
      if (res.status < 400) break;
      delay = Math.min(delay * 2, 60000);
    }
  }

  return res;
};

// ─── List models ───
module.exports.listModels = async function listModels(ctx) {
  var token = getFreshToken(ctx);
  var allModels = [];
  var afterId = undefined;

  for (;;) {
    var url = ctx.baseUrl + "/v1/models?limit=100";
    if (afterId) url += "&after_id=" + encodeURIComponent(afterId);

    var res = await ctx.fetch(url, {
      headers: {
        "authorization": "Bearer " + token,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      },
    });

    // OAuth refresh on 401
    if (res.status === 401) {
      invalidateCache();
      var fresh = getFreshToken(ctx);
      if (fresh && fresh !== token) {
        token = fresh;
        res = await ctx.fetch(url, {
          headers: {
            "authorization": "Bearer " + fresh,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
          },
        });
      }
    }

    if (!res.ok) break;
    var data = await res.json();
    (data.data || []).forEach(function(m) {
      var supportsThinking = /claude-(sonnet|opus)-(4|5)/i.test(m.id) || /claude-4/i.test(m.id);
      allModels.push({
        id: m.id,
        name: m.display_name || m.id,
        supportsThinking: supportsThinking,
        supportsToolUse: true,
        contextLength: 200000,
      });
    });
    if (!data.has_more) break;
    afterId = data.last_id;
  }

  return allModels;
};
