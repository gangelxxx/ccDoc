// providers/openrouter.js
// OpenRouter — universal gateway to 300+ models
// OpenAI-compatible API with extra headers and model metadata

var meta = {
  id: "openrouter",
  name: "OpenRouter",
  description: "OpenRouter.ai — доступ к Claude, GPT, Gemini, Llama и 300+ моделям через единый API",
};
module.exports.meta = meta;

// ─── Convert Anthropic message format → OpenAI format ───

function convertMessages(messages) {
  var result = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];

    // User message with tool_result blocks → split into role:"tool" messages
    if (m.role === "user" && Array.isArray(m.content)) {
      var hasToolResults = m.content.some(function(b) { return b.type === "tool_result"; });
      if (hasToolResults) {
        for (var j = 0; j < m.content.length; j++) {
          var block = m.content[j];
          if (block.type === "tool_result") {
            result.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
            });
          } else if (block.type === "text" && block.text) {
            result.push({ role: "user", content: block.text });
          }
        }
        continue;
      }
    }

    // Assistant message with tool_use blocks → OpenAI tool_calls format
    if (m.role === "assistant" && Array.isArray(m.content)) {
      var text = "";
      var toolCalls = [];
      for (var k = 0; k < m.content.length; k++) {
        var b = m.content[k];
        if (b.type === "text" && b.text) text += b.text;
        if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input || {}),
            },
          });
        }
      }
      var msg = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      result.push(msg);
      continue;
    }

    // Tool result messages (already in OpenAI format) — pass through as-is
    if (m.role === "tool") {
      result.push(m);
      continue;
    }

    // String content — pass through
    if (typeof m.content === "string") {
      result.push({ role: m.role, content: m.content });
      continue;
    }

    // Array content without tool blocks — extract text
    if (Array.isArray(m.content)) {
      var texts = m.content
        .filter(function(b) { return b.type === "text" || typeof b === "string"; })
        .map(function(b) { return typeof b === "string" ? b : b.text || ""; })
        .join("\n");
      result.push({ role: m.role, content: texts || "" });
      continue;
    }

    result.push(m);
  }
  return result;
}

// ─── Chat ───

module.exports.chat = async function chat(ctx, params) {
  var headers = {
    "authorization": "Bearer " + ctx.apiKey,
    "content-type": "application/json",
    "http-referer": "https://ccdoc.app",
    "x-openrouter-title": "ccDoc",
  };

  // Map Anthropic tool defs → OpenAI function calling
  var tools = (params.tools || []).map(function(t) {
    return {
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    };
  });

  // Build system message with prompt caching
  var systemMsg = { role: "system", content: params.system };

  // Apply cache_control to last tool (OpenRouter passes it to supported providers)
  if (tools.length > 0 && !params.skipMessageCache) {
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
  }

  // Apply cache_control to system prompt
  if (!params.skipMessageCache) {
    // OpenRouter supports cache via content array format
    systemMsg = {
      role: "system",
      content: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    };
  }

  var converted = convertMessages(params.messages);

  // Apply sliding cache checkpoint on messages (second-to-last user message)
  if (!params.skipMessageCache && converted.length >= 4) {
    for (var ci = converted.length - 2; ci >= 0; ci--) {
      if (converted[ci].role === "user" && typeof converted[ci].content === "string") {
        converted[ci] = {
          role: "user",
          content: [{ type: "text", text: converted[ci].content, cache_control: { type: "ephemeral" } }],
        };
        break;
      }
    }
  }

  var body = {
    model: ctx.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    messages: [systemMsg].concat(converted),
  };
  if (tools.length > 0) body.tools = tools;

  if (params.thinking) {
    body.reasoning = { max_tokens: params.thinkingBudget };
  }

  var res = await ctx.fetch(ctx.baseUrl + "/chat/completions", {
    method: "POST", headers: headers, body: JSON.stringify(body), signal: params.signal,
  });

  // 402 = out of credits — not retryable
  if (res.status === 402) {
    ctx.log("error", "402 — OpenRouter credits exhausted");
    return res;
  }

  // Rate limit / server error → backoff
  if (res.status === 429 || res.status >= 500) {
    var delay = 3000;
    for (var i = 0; i < 3; i++) {
      ctx.log("warn", res.status + " — retry " + (i + 1) + "/3 after " + delay + "ms");
      await new Promise(function(r) { setTimeout(r, delay); });
      res = await ctx.fetch(ctx.baseUrl + "/chat/completions", {
        method: "POST", headers: headers, body: JSON.stringify(body), signal: params.signal,
      });
      if (res.status < 400) break;
      delay = Math.min(delay * 2, 30000);
    }
  }

  return res;
};

// ─── List models ───

module.exports.listModels = async function listModels(ctx) {
  var res = await ctx.fetch(ctx.baseUrl + "/models", {
    headers: { "authorization": "Bearer " + ctx.apiKey },
  });
  if (!res.ok) return [];
  var data = await res.json();
  return (data.data || []).map(function(m) {
    var params = m.supported_parameters || [];
    return {
      id: m.id,
      name: m.name || m.id,
      contextLength: m.context_length || undefined,
      maxOutput: m.top_provider && m.top_provider.max_completion_tokens || undefined,
      supportsThinking: params.indexOf("reasoning") >= 0 || params.indexOf("thinking") >= 0,
      supportsToolUse: params.indexOf("tools") >= 0 || params.indexOf("tool_choice") >= 0,
      supportedParams: params,
    };
  });
};
