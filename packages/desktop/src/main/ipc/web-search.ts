import { ipcMain } from "electron";

interface WebSearchOptions {
  maxResults?: number;
  searchType?: "general" | "news";
  includeContent?: boolean;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  publishedDate?: string;
}

interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  duration: number;
}

type WebSearchProvider = "tavily" | "brave";

// --- Simple in-memory cache (5 min TTL) ---
const cache = new Map<string, { data: WebSearchResponse; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string): WebSearchResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: WebSearchResponse) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// --- Rate limiting (1 req/sec) ---
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;

async function rateLimit() {
  const now = Date.now();
  const wait = MIN_REQUEST_INTERVAL - (now - lastRequestTime);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestTime = Date.now();
}

// --- Tavily Search ---
async function searchTavily(
  apiKey: string,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResponse> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: options.maxResults ?? 5,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        topic: options.searchType === "news" ? "news" : "general",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily API error ${res.status}: ${text}`);
    }
    const data = await res.json();

    return {
      query,
      results: (data.results || []).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content?.slice(0, 300) ?? "",
        content: options.includeContent ? r.content?.slice(0, 2000) : undefined,
        publishedDate: r.published_date,
      })),
      duration: Date.now() - start,
    };
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error("Web search timed out after 10 seconds");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Brave Search ---
async function searchBrave(
  apiKey: string,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResponse> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(options.maxResults ?? 5),
    });

    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          "X-Subscription-Token": apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Brave Search API error ${res.status}: ${text}`);
    }
    const data = await res.json();

    return {
      query,
      results: (data.web?.results ?? [])
        .slice(0, options.maxResults ?? 5)
        .map((r: any) => {
          const extraSnippets: string[] = r.extra_snippets || [];
          const fullContent = extraSnippets.length
            ? [r.description, ...extraSnippets].filter(Boolean).join("\n\n")
            : "";
          return {
            title: r.title || "",
            url: r.url || "",
            snippet: r.description ?? "",
            content: options.includeContent && fullContent
              ? fullContent.slice(0, 2000)
              : undefined,
          };
        }),
      duration: Date.now() - start,
    };
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error("Web search timed out after 10 seconds");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// --- IPC Registration ---
export function registerWebSearchIpc() {
  ipcMain.handle(
    "web:search",
    async (
      _event,
      args: {
        provider: WebSearchProvider;
        apiKey: string;
        query: string;
        options?: WebSearchOptions;
      },
    ) => {
      const { provider, apiKey, query, options = {} } = args;

      if (!apiKey) throw new Error("Web search API key is not configured");
      if (!query?.trim()) throw new Error("Search query is empty");

      // Clamp maxResults to [1, 10]
      const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 10);
      const normalizedOptions = { ...options, maxResults };

      // Cache key includes all parameters that affect results
      const searchType = options.searchType ?? "general";
      const cacheKey = `${provider}:${query}:${maxResults}:${searchType}:${!!options.includeContent}`;
      const cached = getCached(cacheKey);
      if (cached) return cached;

      await rateLimit();

      let result: WebSearchResponse;
      switch (provider) {
        case "tavily":
          result = await searchTavily(apiKey, query.trim(), normalizedOptions);
          break;
        case "brave":
          result = await searchBrave(apiKey, query.trim(), normalizedOptions);
          break;
        default:
          throw new Error(`Unknown search provider: ${provider}`);
      }

      setCache(cacheKey, result);
      return result;
    },
  );
}
