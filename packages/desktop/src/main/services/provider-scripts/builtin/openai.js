// providers/openai.js
// OpenAI and compatible APIs (OpenRouter, Together, etc.)

var meta = {
  id: "openai",
  name: "OpenAI / Compatible",
  description: "OpenAI, OpenRouter, Together, or any compatible API",
};
module.exports.meta = meta;

// Convert Anthropic message format → OpenAI format
function convertMessages(messages) {
  var result = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === "user" && Array.isArray(m.content)) {
      var hasToolResults = m.content.some(function(b) { return b.type === "tool_result"; });
      if (hasToolResults) {
        for (var j = 0; j < m.content.length; j++) {
          var block = m.content[j];
          if (block.type === "tool_result") {
            result.push({ role: "tool", tool_call_id: block.tool_use_id, content: typeof block.content === "string" ? block.content : JSON.stringify(block.content) });
          } else if (block.type === "text" && block.text) {
            result.push({ role: "user", content: block.text });
          }
        }
        continue;
      }
    }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      var text = "";
      var toolCalls = [];
      for (var k = 0; k < m.content.length; k++) {
        var b = m.content[k];
        if (b.type === "text" && b.text) text += b.text;
        if (b.type === "tool_use") {
          toolCalls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input || {}) } });
        }
      }
      var msg = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      result.push(msg);
      continue;
    }
    if (m.role === "tool") { result.push(m); continue; }
    if (typeof m.content === "string") { result.push({ role: m.role, content: m.content }); continue; }
    if (Array.isArray(m.content)) {
      var texts = m.content.filter(function(b) { return b.type === "text" || typeof b === "string"; }).map(function(b) { return typeof b === "string" ? b : b.text || ""; }).join("\n");
      result.push({ role: m.role, content: texts || "" });
      continue;
    }
    result.push(m);
  }
  return result;
}

module.exports.chat = async function chat(ctx, params) {
  var headers = {
    "authorization": "Bearer " + ctx.apiKey,
    "content-type": "application/json",
  };

  var tools = (params.tools || []).map(function(t) {
    return {
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    };
  });

  var body = {
    model: ctx.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    messages: [
      { role: "system", content: params.system },
    ].concat(convertMessages(params.messages)),
  };
  if (tools.length > 0) body.tools = tools;

  var res = await ctx.fetch(ctx.baseUrl + "/chat/completions", {
    method: "POST", headers: headers, body: JSON.stringify(body), signal: params.signal,
  });

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

module.exports.listModels = async function listModels(ctx) {
  var res = await ctx.fetch(ctx.baseUrl + "/models", {
    headers: { "authorization": "Bearer " + ctx.apiKey },
  });
  if (!res.ok) return [];
  var data = await res.json();
  return (data.data || []).map(function(m) {
    return { id: m.id, name: m.id };
  });
};
