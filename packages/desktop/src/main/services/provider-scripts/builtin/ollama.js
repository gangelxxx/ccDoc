// providers/ollama.js
// Ollama local model (no API key required)

var meta = {
  id: "ollama",
  name: "Ollama (local)",
  description: "Local model via Ollama, no API key needed",
};
module.exports.meta = meta;

module.exports.chat = async function chat(ctx, params) {
  var body = {
    model: ctx.model,
    messages: [
      { role: "system", content: params.system },
    ].concat(params.messages),
    stream: false,
  };

  var res = await ctx.fetch(ctx.baseUrl + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  // Server error → backoff
  if (res.status >= 500) {
    var delay = 2000;
    for (var i = 0; i < 2; i++) {
      ctx.log("warn", res.status + " — retry " + (i + 1) + "/2 after " + delay + "ms");
      await new Promise(function(r) { setTimeout(r, delay); });
      res = await ctx.fetch(ctx.baseUrl + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: params.signal,
      });
      if (res.status < 400) break;
      delay = delay * 2;
    }
  }

  return res;
};

module.exports.listModels = async function listModels(ctx) {
  var res = await ctx.fetch(ctx.baseUrl + "/api/tags", {});
  if (!res.ok) return [];
  var data = await res.json();
  return (data.models || []).map(function(m) {
    return { id: m.name, name: m.name };
  });
};
