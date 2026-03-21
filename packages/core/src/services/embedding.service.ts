import { createHash } from "crypto";
import { existsSync } from "fs";
import { join } from "path";

export interface LocalModelDef {
  id: string;
  name: string;
  description: string;
  sizeLabel: string;
  dimensions: number;
  files: Array<{ name: string; url: string; sizeBytes?: number }>;
}

export const LOCAL_MODELS: LocalModelDef[] = [
  {
    id: "multilingual-e5-small",
    name: "multilingual-e5-small",
    description: "Multilingual, 100+ languages",
    sizeLabel: "130 MB",
    dimensions: 384,
    files: [
      { name: "model.onnx", url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model.onnx", sizeBytes: 120_000_000 },
      { name: "tokenizer.json", url: "https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/tokenizer.json" },
    ],
  },
  {
    id: "all-MiniLM-L6-v2",
    name: "all-MiniLM-L6-v2",
    description: "English only, fast and compact",
    sizeLabel: "90 MB",
    dimensions: 384,
    files: [
      { name: "model.onnx", url: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx", sizeBytes: 90_000_000 },
      { name: "tokenizer.json", url: "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json" },
    ],
  },
];

export type EmbeddingMode = "none" | "local" | "online";
export type OnlineProvider = "openai" | "voyage";

export interface EmbeddingConfig {
  mode: EmbeddingMode;
  localModelId: string;
  onlineProvider: OnlineProvider;
  onlineModel: string;
  onlineApiKey: string;
}

/**
 * Load onnxruntime-node at runtime without esbuild trying to resolve it.
 * The eval() hides the require/import from static analysis.
 */
async function loadOrt(): Promise<any> {
  try {
    // In CJS context (Electron), use require
    if (typeof require !== "undefined") {
      return eval('require')("onnxruntime-node");
    }
    // In ESM context
    const m = await eval('import("onnxruntime-node")');
    return m;
  } catch {
    return null;
  }
}

const EMBEDDING_DIM = 384;

export class EmbeddingModel {
  private session: any = null;
  private tokenizer: any = null;
  private ort: any = null;
  private _available: boolean | null = null;
  private loading: Promise<boolean> | null = null;

  constructor(private modelDir: string) {}

  /**
   * Check if the model files exist on disk.
   */
  isAvailable(): boolean {
    if (this._available !== null) return this._available;
    const modelPath = join(this.modelDir, "model.onnx");
    const tokenizerPath = join(this.modelDir, "tokenizer.json");
    this._available = existsSync(modelPath) && existsSync(tokenizerPath);
    return this._available;
  }

  /**
   * Lazily load the ONNX model and tokenizer.
   * Returns true if loaded successfully, false otherwise.
   */
  async load(): Promise<boolean> {
    if (this.session) return true;
    if (!this.isAvailable()) return false;
    if (this.loading) return this.loading;

    this.loading = this._load();
    return this.loading;
  }

  private async _load(): Promise<boolean> {
    try {
      this.ort = await loadOrt();
      if (!this.ort) throw new Error("onnxruntime-node not installed");
      const { readFile } = await import("fs/promises");

      const modelPath = join(this.modelDir, "model.onnx");
      const tokenizerPath = join(this.modelDir, "tokenizer.json");

      this.session = await this.ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });

      const tokenizerJson = JSON.parse(await readFile(tokenizerPath, "utf-8"));
      this.tokenizer = new SimpleTokenizer(tokenizerJson);

      console.log("[embedding] Model loaded successfully");
      return true;
    } catch (err) {
      console.warn("[embedding] Failed to load model:", err);
      this.session = null;
      this.tokenizer = null;
      this.ort = null;
      this._available = false;
      return false;
    }
  }

  /**
   * Encode text into a normalized embedding vector.
   * E5 models expect "query: " or "passage: " prefix.
   */
  async encode(text: string, prefix = "passage: "): Promise<Float32Array> {
    if (!this.session) {
      const loaded = await this.load();
      if (!loaded) throw new Error("Embedding model not available");
    }

    const ort = this.ort;
    const inputText = prefix + text;
    const { inputIds, attentionMask } = this.tokenizer.encode(inputText, 512);

    const inputIdsTensor = new ort.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
    const attentionMaskTensor = new ort.Tensor("int64", BigInt64Array.from(attentionMask.map(BigInt)), [1, attentionMask.length]);
    const tokenTypeIds = new ort.Tensor("int64", new BigInt64Array(inputIds.length), [1, inputIds.length]);

    const result = await this.session.run({
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
      token_type_ids: tokenTypeIds,
    });

    // Mean pooling over token embeddings, masked by attention
    const lastHidden = result["last_hidden_state"] ?? result[Object.keys(result)[0]];
    const data = lastHidden.data as Float32Array;
    const seqLen = inputIds.length;

    const pooled = new Float32Array(EMBEDDING_DIM);
    let maskSum = 0;
    for (let i = 0; i < seqLen; i++) {
      if (attentionMask[i] === 1) {
        maskSum++;
        for (let j = 0; j < EMBEDDING_DIM; j++) {
          pooled[j] += data[i * EMBEDDING_DIM + j];
        }
      }
    }
    // Average
    for (let j = 0; j < EMBEDDING_DIM; j++) {
      pooled[j] /= maskSum;
    }

    // L2 normalize
    let norm = 0;
    for (let j = 0; j < EMBEDDING_DIM; j++) norm += pooled[j] * pooled[j];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < EMBEDDING_DIM; j++) pooled[j] /= norm;
    }

    return pooled;
  }

  /**
   * Encode a search query (uses "query: " prefix for E5).
   */
  async encodeQuery(text: string): Promise<Float32Array> {
    return this.encode(text, "query: ");
  }

  get dimension(): number {
    return EMBEDDING_DIM;
  }
}

/**
 * Cosine similarity between two normalized vectors (= dot product).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Compute a short hash of text for change detection.
 */
export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Minimal WordPiece tokenizer that reads a HuggingFace tokenizer.json.
 * Supports only the subset needed for E5-small inference.
 */
class SimpleTokenizer {
  private vocab: Map<string, number>;
  private unkId: number;
  private clsId: number;
  private sepId: number;

  constructor(tokenizerJson: any) {
    this.vocab = new Map<string, number>();
    const model = tokenizerJson.model;
    if (model?.vocab) {
      // WordPiece format: vocab is an object { token: id }
      for (const [token, id] of Object.entries(model.vocab)) {
        this.vocab.set(token, id as number);
      }
    }
    this.unkId = this.vocab.get("[UNK]") ?? 0;
    this.clsId = this.vocab.get("[CLS]") ?? 101;
    this.sepId = this.vocab.get("[SEP]") ?? 102;
  }

  encode(text: string, maxLen: number): { inputIds: number[]; attentionMask: number[] } {
    // Basic pre-tokenization: lowercase, split on whitespace and punctuation
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    const words = normalized.match(/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF]+|[^\s]/g) || [];

    const tokens: number[] = [this.clsId];

    for (const word of words) {
      if (tokens.length >= maxLen - 1) break;
      const wordPieces = this.tokenizeWord(word);
      for (const piece of wordPieces) {
        if (tokens.length >= maxLen - 1) break;
        tokens.push(piece);
      }
    }

    tokens.push(this.sepId);

    const attentionMask = new Array(tokens.length).fill(1);
    return { inputIds: tokens, attentionMask };
  }

  private tokenizeWord(word: string): number[] {
    // Try whole word first
    const directId = this.vocab.get(word);
    if (directId !== undefined) return [directId];

    // WordPiece: greedily match longest subwords
    const pieces: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let found = false;
      while (start < end) {
        const sub = start === 0 ? word.slice(start, end) : "##" + word.slice(start, end);
        const id = this.vocab.get(sub);
        if (id !== undefined) {
          pieces.push(id);
          start = end;
          found = true;
          break;
        }
        end--;
      }
      if (!found) {
        pieces.push(this.unkId);
        start++;
      }
    }
    return pieces;
  }
}
