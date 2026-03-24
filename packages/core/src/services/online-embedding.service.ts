import type { IEmbeddingProvider, OnlineProvider } from "./embedding.service.js";

interface OnlineModelDef {
  provider: OnlineProvider;
  model: string;
  dimensions: number;
  endpoint: string;
}

const ONLINE_MODELS: Record<string, OnlineModelDef> = {
  // OpenAI
  "text-embedding-3-small": { provider: "openai", model: "text-embedding-3-small", dimensions: 1536, endpoint: "https://api.openai.com/v1/embeddings" },
  "text-embedding-3-large": { provider: "openai", model: "text-embedding-3-large", dimensions: 3072, endpoint: "https://api.openai.com/v1/embeddings" },
  "text-embedding-ada-002": { provider: "openai", model: "text-embedding-ada-002", dimensions: 1536, endpoint: "https://api.openai.com/v1/embeddings" },
  // Voyage
  "voyage-3": { provider: "voyage", model: "voyage-3", dimensions: 1024, endpoint: "https://api.voyageai.com/v1/embeddings" },
  "voyage-3-lite": { provider: "voyage", model: "voyage-3-lite", dimensions: 512, endpoint: "https://api.voyageai.com/v1/embeddings" },
  "voyage-multilingual-2": { provider: "voyage", model: "voyage-multilingual-2", dimensions: 1024, endpoint: "https://api.voyageai.com/v1/embeddings" },
};

export class OnlineEmbeddingProvider implements IEmbeddingProvider {
  private modelDef: OnlineModelDef | null;

  constructor(
    private provider: OnlineProvider,
    private model: string,
    private apiKey: string
  ) {
    this.modelDef = ONLINE_MODELS[model] ?? null;
    // Fallback: construct model def from provider info
    if (!this.modelDef && provider && model) {
      const endpoint = provider === "openai"
        ? "https://api.openai.com/v1/embeddings"
        : "https://api.voyageai.com/v1/embeddings";
      this.modelDef = { provider, model, dimensions: 1536, endpoint };
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey && !!this.modelDef;
  }

  async load(): Promise<boolean> {
    return this.isAvailable();
  }

  async encode(text: string): Promise<Float32Array> {
    return this.callApi(text);
  }

  async encodeQuery(text: string): Promise<Float32Array> {
    // Voyage supports input_type, OpenAI doesn't need prefix
    return this.callApi(text, "query");
  }

  get dimension(): number {
    return this.modelDef?.dimensions ?? 1536;
  }

  private async callApi(text: string, inputType?: "query" | "document"): Promise<Float32Array> {
    if (!this.modelDef || !this.apiKey) {
      throw new Error("Online embedding provider not configured");
    }

    const body: Record<string, unknown> = {
      model: this.modelDef.model,
      input: text,
    };

    // Voyage supports input_type parameter
    if (this.modelDef.provider === "voyage" && inputType) {
      body.input_type = inputType;
    }

    const authHeader = this.modelDef.provider === "openai"
      ? `Bearer ${this.apiKey}`
      : `Bearer ${this.apiKey}`;

    const response = await fetch(this.modelDef.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Embedding API error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const json = await response.json() as { data: Array<{ embedding: number[] }> };

    if (!json.data?.[0]?.embedding) {
      throw new Error("Unexpected embedding API response format");
    }

    return new Float32Array(json.data[0].embedding);
  }
}
