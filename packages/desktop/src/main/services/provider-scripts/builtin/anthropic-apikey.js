// providers/anthropic-apikey.js
// Anthropic via API Key (x-api-key header)
// No Claude Code Identity, no OAuth refresh

var meta = {
  id: "anthropic-apikey",
  name: "Anthropic (API Key)",
  description: "Claude via API Key (sk-ant-api03-...)",
};
module.exports.meta = meta;

module.exports.chat = async function chat(ctx, params) {
  var headers = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "x-api-key": ctx.apiKey,
    "anthropic-beta": "prompt-caching-2024-07-31",
  };

  // System with caching
  var sys = [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }];

  // Tools with caching on last
  var tools = params.tools || [];
  if (tools.length > 0) {
    tools = tools.map(function(t, i) {
      return i === tools.length - 1
        ? Object.assign({}, t, { cache_control: { type: "ephemeral" } })
        : t;
    });
  }

  var body = {
    model: ctx.model,
    max_tokens: params.maxTokens,
    system: sys,
    messages: params.messages,
  };
  if (tools.length > 0) body.tools = tools;
  if (params.thinking) {
    body.thinking = { type: "enabled", budget_tokens: params.thinkingBudget };
  }
  if (params.toolChoice) body.tool_choice = params.toolChoice;
  if (params.temperature !== undefined && !params.thinking) {
    body.temperature = params.temperature;
  }

  var bodyStr = JSON.stringify(body);

  var res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
    method: "POST", headers: headers, body: bodyStr, signal: params.signal,
  });

  // Fallback: 400 → remove caching
  if (res.status === 400) {
    ctx.log("warn", "400 — retrying without prompt caching");
    delete headers["anthropic-beta"];
    body.system = params.system;
    bodyStr = JSON.stringify(body);
    res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
      method: "POST", headers: headers, body: bodyStr, signal: params.signal,
    });
  }

  // Rate limit / server error → backoff
  if (res.status === 429 || res.status >= 500) {
    var delay = 3000;
    for (var i = 0; i < 3; i++) {
      ctx.log("warn", res.status + " — retry " + (i + 1) + "/3 after " + delay + "ms");
      await new Promise(function(r) { setTimeout(r, delay); });
      res = await ctx.fetch(ctx.baseUrl + "/v1/messages", {
        method: "POST", headers: headers, body: bodyStr, signal: params.signal,
      });
      if (res.status < 400) break;
      delay = Math.min(delay * 2, 30000);
    }
  }

  return res;
};

module.exports.listModels = async function listModels(ctx) {
  var allModels = [];
  var afterId = undefined;

  for (;;) {
    var url = ctx.baseUrl + "/v1/models?limit=100";
    if (afterId) url += "&after_id=" + encodeURIComponent(afterId);

    var res = await ctx.fetch(url, {
      headers: {
        "x-api-key": ctx.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) break;
    var data = await res.json();
    (data.data || []).forEach(function(m) {
      // All Claude models support tool use; thinking supported on Sonnet 4+ and Opus 4+
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
