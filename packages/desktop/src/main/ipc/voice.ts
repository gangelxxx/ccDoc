import { ipcMain } from "electron";
import { join, dirname } from "path";
import { mkdirSync, existsSync, rmSync, readdirSync, createWriteStream } from "fs";
import { homedir } from "os";
import https from "https";
import Module from "module";
import { pathToFileURL } from "url";
import { getMainWindow } from "../window";

// Redirect onnxruntime-node → onnxruntime-web in Electron.
// onnxruntime-node's native DLL fails to initialize in Electron,
// but onnxruntime-web registers 'cpu' as a WASM backend alias, so it's a drop-in replacement.
const _origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "onnxruntime-node") {
    return _origResolve.call(this, "onnxruntime-web", ...args);
  }
  return _origResolve.call(this, request, ...args);
};

const VOICE_MODELS_DIR = join(homedir(), ".ccdoc", "models", "voice");

const WHISPER_MODELS: Record<string, { repo: string }> = {
  "whisper-tiny": { repo: "onnx-community/whisper-tiny" },
  "whisper-base": { repo: "onnx-community/whisper-base" },
  "whisper-small": { repo: "onnx-community/whisper-small" },
};

let transcriber: any = null;
let currentModelId: string | null = null;
const activeDownloads = new Map<string, () => void>(); // modelId -> cancel fn

/** Returns "none" | "partial" | "ready" */
function getModelStatus(modelId: string): "none" | "partial" | "ready" {
  // Files are stored at: VOICE_MODELS_DIR/{modelId}/{repo}/...
  const model = WHISPER_MODELS[modelId];
  if (!model) return "none";
  const repoDir = join(VOICE_MODELS_DIR, modelId, model.repo);
  if (!existsSync(repoDir)) {
    // Check if parent dir has any files (legacy or partial)
    const parentDir = join(VOICE_MODELS_DIR, modelId);
    if (!existsSync(parentDir)) return "none";
    try {
      const files = readdirSync(parentDir, { recursive: true }) as string[];
      return files.length > 0 ? "partial" : "none";
    } catch { return "none"; }
  }
  try {
    const files = readdirSync(repoDir, { recursive: true }) as string[];
    if (files.length === 0) return "none";
    return files.some((f) => f.toString().endsWith(".onnx")) ? "ready" : "partial";
  } catch {
    return "none";
  }
}

// ─── HTTP helpers ─────────────────────────────────────────

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = (targetUrl: string, redirects = 0) => {
      if (redirects > 10) { reject(new Error("Too many redirects")); return; }
      const opts = new URL(targetUrl);
      https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "ccdoc/1.0" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const loc = res.headers.location;
          request(loc.startsWith("http") ? loc : new URL(loc, targetUrl).toString(), redirects + 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let body = "";
        res.on("data", (c: Buffer) => body += c);
        res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
      }).on("error", reject);
    };
    request(url);
  });
}

function downloadFile(
  url: string, destPath: string,
  onProgress: (received: number, total: number) => void,
  cancelRef: { cancel?: () => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    cancelRef.cancel = () => { cancelled = true; reject(new Error("Cancelled")); };

    const request = (targetUrl: string, redirects = 0) => {
      if (cancelled) return;
      if (redirects > 10) { reject(new Error("Too many redirects")); return; }
      const opts = new URL(targetUrl);
      const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "ccdoc/1.0" } }, (res) => {
        if (cancelled) { res.resume(); return; }
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const loc = res.headers.location;
          request(loc.startsWith("http") ? loc : new URL(loc, targetUrl).toString(), redirects + 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`)); return; }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        mkdirSync(dirname(destPath), { recursive: true });
        const file = createWriteStream(destPath);
        cancelRef.cancel = () => { cancelled = true; req.destroy(); file.destroy(); reject(new Error("Cancelled")); };
        res.on("data", (chunk: Buffer) => { if (!cancelled) { received += chunk.length; onProgress(received, total); } });
        res.pipe(file);
        file.on("finish", () => { file.close(); if (!cancelled) resolve(); });
        file.on("error", (err) => { file.close(); if (!cancelled) reject(err); });
      }).on("error", (err) => { if (!cancelled) reject(err); });
    };
    request(url);
  });
}

/** List all files in a HuggingFace repo (recursive) */
async function listRepoFiles(repo: string): Promise<{ path: string; size: number }[]> {
  const results: { path: string; size: number }[] = [];

  async function walk(treePath: string) {
    const url = `https://huggingface.co/api/models/${repo}/tree/main${treePath ? "/" + treePath : ""}`;
    const items = await httpsGet(url) as any[];
    for (const item of items) {
      if (item.type === "file") {
        results.push({ path: item.path, size: item.size || 0 });
      } else if (item.type === "directory") {
        await walk(item.path);
      }
    }
  }

  await walk("");
  return results;
}

export function registerVoiceIpc(): void {
  ipcMain.handle("voice:status", async () => {
    const statuses: Record<string, "none" | "partial" | "ready"> = {};
    for (const modelId of Object.keys(WHISPER_MODELS)) {
      statuses[modelId] = getModelStatus(modelId);
    }
    return { statuses };
  });

  ipcMain.handle("voice:download", async (_e, modelId: string) => {
    const model = WHISPER_MODELS[modelId];
    if (!model) throw new Error("Unknown voice model: " + modelId);

    // Cancel previous download if any
    activeDownloads.get(modelId)?.();
    activeDownloads.delete(modelId);

    const modelDir = join(VOICE_MODELS_DIR, modelId);
    mkdirSync(modelDir, { recursive: true });

    const send = (data: object) => {
      getMainWindow()?.webContents.send("voice:progress", { modelId, ...data });
    };

    const cancelRef: { cancel?: () => void } = {};
    activeDownloads.set(modelId, () => cancelRef.cancel?.());

    try {
      send({ percent: 1 });

      // 1. List files in the HuggingFace repo
      const allFiles = await listRepoFiles(model.repo);
      if (cancelRef.cancel === undefined) { /* already cancelled */ }

      // Filter: only download what pipeline() needs (configs, tokenizer, onnx models)
      // Skip: README, .gitattributes, quantized variants (q4, q8), etc.
      const needed = allFiles.filter((f) => {
        const p = f.path;
        if (p.endsWith(".md") || p.endsWith(".gitattributes") || p.endsWith(".gitignore")) return false;
        if (p.startsWith("onnx/") && p.endsWith(".onnx")) {
          // Only download fp32 (non-quantized) models
          if (p.includes("_q4") || p.includes("_q8") || p.includes("quantized")) return false;
          return true;
        }
        if (p.endsWith(".json") || p.endsWith(".txt") || p.endsWith(".model")) return true;
        if (p.startsWith("onnx/") && p.endsWith("_data")) return true; // external data files
        return false;
      });

      const totalBytes = needed.reduce((s, f) => s + f.size, 0);
      let downloadedBytes = 0;
      let lastPercent = 1;

      send({ percent: 2 });

      // 2. Download each file into {modelDir}/{repo}/ subdirectory
      // pipeline() with cache_dir expects: cache_dir/{org}/{model}/file.path
      const repoSubDir = join(modelDir, model.repo);
      for (const file of needed) {
        const destPath = join(repoSubDir, file.path);
        if (existsSync(destPath)) {
          // Already downloaded (resume support)
          downloadedBytes += file.size;
          const pct = Math.round(Math.min(99, 2 + (downloadedBytes / totalBytes) * 97));
          if (pct > lastPercent) { lastPercent = pct; send({ percent: pct }); }
          continue;
        }

        const fileUrl = `https://huggingface.co/${model.repo}/resolve/main/${file.path}`;
        await downloadFile(fileUrl, destPath, (received, _total) => {
          const pct = Math.round(Math.min(99, 2 + ((downloadedBytes + received) / totalBytes) * 97));
          if (pct > lastPercent) { lastPercent = pct; send({ percent: pct }); }
        }, cancelRef);

        downloadedBytes += file.size;
      }

      send({ done: true });
    } catch (err: any) {
      if (err.message === "Cancelled") {
        send({ cancelled: true });
      } else {
        console.error("[voice:download] error:", err);
        send({ error: err.message || "Download failed" });
      }
    } finally {
      activeDownloads.delete(modelId);
    }
  });

  ipcMain.handle("voice:cancel", (_e, modelId: string) => {
    activeDownloads.get(modelId)?.();
    activeDownloads.delete(modelId);
  });

  ipcMain.handle("voice:delete", async (_e, modelId: string) => {
    // Dispose transcriber if loaded for this model (releases ONNX file locks)
    if (currentModelId === modelId && transcriber) {
      try {
        if (typeof transcriber.dispose === "function") await transcriber.dispose();
      } catch { /* ignore */ }
      transcriber = null;
      currentModelId = null;
      // Windows needs time to release file locks after ONNX dispose
      await new Promise((r) => setTimeout(r, 500));
    }

    const dir = join(VOICE_MODELS_DIR, modelId);
    if (!existsSync(dir)) return;

    // Retry loop: ONNX runtime may hold file locks briefly after dispose
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        return;
      } catch (err: any) {
        if (attempt < 4) {
          console.log(`[voice:delete] attempt ${attempt + 1} failed (${err.code}), retrying...`);
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          throw err;
        }
      }
    }
  });

  ipcMain.handle("voice:transcribe", async (_e, { audio, modelId, language }: { audio: Float32Array; modelId: string; language?: string }) => {
    console.log("[voice:transcribe] start, modelId:", modelId, "samples:", audio?.length, "language:", language);
    const model = WHISPER_MODELS[modelId];
    if (!model) throw new Error("Unknown voice model: " + modelId);
    const status = getModelStatus(modelId);
    console.log("[voice:transcribe] model status:", status);
    if (status !== "ready") throw new Error("Model not downloaded: " + modelId);

    // Lazy-init or switch model
    if (!transcriber || currentModelId !== modelId) {
      if (transcriber && typeof transcriber.dispose === "function") {
        try { await transcriber.dispose(); } catch { /* ignore */ }
      }
      console.log("[voice:transcribe] loading pipeline...");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hf = require("@huggingface/transformers");
      // Override CDN wasmPaths set by transformers during init —
      // CDN https:// URLs fail in Node.js/Electron (ERR_UNSUPPORTED_ESM_URL_SCHEME).
      // Point to local transformers dist dir which bundles the WASM files.
      // Resolve onnxruntime-web from transformers' context (1.22.0-dev, not desktop's 1.24.3)
      const hfDir = dirname(require.resolve("@huggingface/transformers"));
      const ortWebDistDir = pathToFileURL(
        dirname(require.resolve("onnxruntime-web", { paths: [hfDir] })) + "/"
      ).href;
      hf.env.backends.onnx.wasm.wasmPaths = ortWebDistDir;
      const { pipeline } = hf;
      const modelDir = join(VOICE_MODELS_DIR, modelId);
      console.log("[voice:transcribe] cache_dir:", modelDir, "repo:", model.repo);
      transcriber = await pipeline("automatic-speech-recognition", model.repo, {
        cache_dir: modelDir,
        local_files_only: true,
      });
      currentModelId = modelId;
      console.log("[voice:transcribe] pipeline loaded");
    }

    // Audio comes as raw Float32Array PCM (16kHz mono) from renderer
    console.log("[voice:transcribe] running inference, samples:", audio.length, "duration:", (audio.length / 16000).toFixed(1), "s");
    const result = await transcriber(audio, {
      language: language || undefined,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    console.log("[voice:transcribe] result:", result?.text);

    return result.text as string;
  });
}
