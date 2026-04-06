import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OnlineEmbeddingProvider } from "../services/online-embedding.service.js";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSuccessResponse(embedding: number[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ data: [{ embedding }] }),
    text: vi.fn().mockResolvedValue(""),
  };
}

describe("OnlineEmbeddingProvider.isAvailable", () => {
  it("returns true when key and known model are provided", () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "sk-test");
    expect(provider.isAvailable()).toBe(true);
  });

  it("returns false if apiKey is empty", () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "");
    expect(provider.isAvailable()).toBe(false);
  });

  it("returns true for unknown model when provider is specified (fallback)", () => {
    const provider = new OnlineEmbeddingProvider("openai", "custom-model-v1", "sk-test");
    expect(provider.isAvailable()).toBe(true);
  });
});

describe("OnlineEmbeddingProvider.load", () => {
  it("returns true if isAvailable() === true", async () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "sk-test");
    expect(await provider.load()).toBe(true);
  });

  it("returns false if apiKey is empty", async () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "");
    expect(await provider.load()).toBe(false);
  });
});

describe("OnlineEmbeddingProvider.encode", () => {
  it("calls fetch with correct parameters for OpenAI", async () => {
    const emb = [0.1, 0.2, 0.3];
    mockFetch.mockResolvedValue(makeSuccessResponse(emb));

    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "sk-test-key");
    const result = await provider.encode("hello world");

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer sk-test-key");

    const body = JSON.parse(options.body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toBe("hello world");
    // OpenAI should not receive input_type
    expect(body.input_type).toBeUndefined();

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(emb.length);
    for (let i = 0; i < emb.length; i++) {
      expect(result[i]).toBeCloseTo(emb[i], 5);
    }
  });

  it("calls fetch without input_type for Voyage on encode (not query)", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse([0.5, 0.5]));

    const provider = new OnlineEmbeddingProvider("voyage", "voyage-3", "voy-key");
    await provider.encode("test text");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // encode does not pass inputType, so input_type should not be in the body
    expect(body.input_type).toBeUndefined();
  });
});

describe("OnlineEmbeddingProvider.encodeQuery", () => {
  it("calls fetch with input_type 'query' for Voyage", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse([0.1, 0.2]));

    const provider = new OnlineEmbeddingProvider("voyage", "voyage-3", "voy-key");
    await provider.encodeQuery("search query");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");

    const body = JSON.parse(options.body);
    expect(body.input_type).toBe("query");
    expect(body.model).toBe("voyage-3");
  });

  it("does not add input_type for OpenAI on encodeQuery", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse([0.1, 0.2, 0.3]));

    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "sk-key");
    await provider.encodeQuery("test query");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input_type).toBeUndefined();
  });
});

describe("OnlineEmbeddingProvider — error handling", () => {
  it("API error → throws Error with message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    });

    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "bad-key");
    await expect(provider.encode("test")).rejects.toThrow("Embedding API error 401");
  });

  it("invalid response format → throws Error", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    });

    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "sk-key");
    await expect(provider.encode("test")).rejects.toThrow("Unexpected embedding API response format");
  });

  it("provider not configured → throws Error", async () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "");
    await expect(provider.encode("test")).rejects.toThrow("Online embedding provider not configured");
  });
});

describe("OnlineEmbeddingProvider.dimension", () => {
  it("returns correct value for text-embedding-3-small", () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-small", "key");
    expect(provider.dimension).toBe(1536);
  });

  it("returns correct value for text-embedding-3-large", () => {
    const provider = new OnlineEmbeddingProvider("openai", "text-embedding-3-large", "key");
    expect(provider.dimension).toBe(3072);
  });

  it("returns correct value for voyage-3", () => {
    const provider = new OnlineEmbeddingProvider("voyage", "voyage-3", "key");
    expect(provider.dimension).toBe(1024);
  });

  it("returns correct value for voyage-3-lite", () => {
    const provider = new OnlineEmbeddingProvider("voyage", "voyage-3-lite", "key");
    expect(provider.dimension).toBe(512);
  });

  it("returns 1536 by default for an unknown model", () => {
    const provider = new OnlineEmbeddingProvider("openai", "unknown-model", "key");
    expect(provider.dimension).toBe(1536);
  });
});
