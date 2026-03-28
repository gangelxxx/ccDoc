import { ipcMain, net } from "electron";
import { join, dirname } from "path";
import { mkdirSync, existsSync, rmSync, readdirSync, createWriteStream } from "fs";
import { homedir } from "os";
import https from "https";
import Module from "module";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { getMainWindow } from "../window";
import { loadGigaAM, transcribeGigaAM, disposeGigaAM, isGigaAMLoaded } from "./gigaam";

// Redirect onnxruntime-node → onnxruntime-web in Electron.
// onnxruntime-node's native DLL fails to initialize in Electron,
// but onnxruntime-web registers 'cpu' as a WASM backend alias, so it's a drop-in replacement.
const _origResolve = (Module as any)._resolveFilename;
const _patchedResolve = function (this: unknown, request: string, ...args: any[]) {
  if (request === "onnxruntime-node") {
    return _origResolve.call(this, "onnxruntime-web", ...args);
  }
  return _origResolve.call(this, request, ...args);
};
(_patchedResolve as any).__original = _origResolve;
(Module as any)._resolveFilename = _patchedResolve;

const VOICE_MODELS_DIR = join(homedir(), ".ccdoc", "models", "voice");

type ModelEntry =
  | { type: "hf"; repo: string }
  | { type: "tarball"; url: string; extractDir: string; onnxFile: string };

const VOICE_MODELS_REPO: Record<string, ModelEntry> = {
  // Legacy (backward compat, hidden from UI)
  "whisper-tiny": { type: "hf", repo: "onnx-community/whisper-tiny" },
  "whisper-base": { type: "hf", repo: "onnx-community/whisper-base" },
  // GigaAM (custom CTC pipeline, downloaded from CDN)
  "gigaam-v3": {
    type: "tarball",
    url: "https://blob.handy.computer/giga-am-v3-int8.tar.gz",
    extractDir: ".",
    onnxFile: "model.int8.onnx",
  },
  // Moonshine (transformers.js compatible)
  "moonshine-v2-tiny": { type: "hf", repo: "onnx-community/moonshine-tiny-ONNX" },
  "moonshine-base": { type: "hf", repo: "onnx-community/moonshine-base-ONNX" },
  // Whisper (transformers.js compatible)
  "whisper-small": { type: "hf", repo: "onnx-community/whisper-small" },
  "whisper-medium": { type: "hf", repo: "onnx-community/whisper-medium-ONNX" },
  "whisper-large": { type: "hf", repo: "onnx-community/whisper-large-v3-ONNX" },
  "whisper-turbo": { type: "hf", repo: "onnx-community/whisper-large-v3-turbo" },
};

let transcriber: any = null;
let currentModelId: string | null = null;
const activeDownloads = new Map<string, () => void>(); // modelId -> cancel fn

/** Returns "none" | "partial" | "ready" */
function getModelStatus(modelId: string): "none" | "partial" | "ready" {
  const model = VOICE_MODELS_REPO[modelId];
  if (!model) return "none";

  if (model.type === "tarball") {
    // Tarball models: check for extracted onnx file
    const onnxPath = join(VOICE_MODELS_DIR, modelId, model.extractDir, model.onnxFile);
    if (existsSync(onnxPath)) return "ready";
    const parentDir = join(VOICE_MODELS_DIR, modelId);
    if (!existsSync(parentDir)) return "none";
    try {
      const files = readdirSync(parentDir, { recursive: true }) as string[];
      return files.length > 0 ? "partial" : "none";
    } catch { return "none"; }
  }

  // HuggingFace models: check for .onnx files in repo subdir
  const repoDir = join(VOICE_MODELS_DIR, modelId, model.repo);
  if (!existsSync(repoDir)) {
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
      console.log(`[voice:downloadFile] requesting ${targetUrl} (redirect ${redirects})`);
      const opts = new URL(targetUrl);
      const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "ccdoc/1.0" } }, (res) => {
        console.log(`[voice:downloadFile] response status=${res.statusCode}, content-length=${res.headers["content-length"]}`);
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
        let lastLogTime = Date.now();
        let firstChunk = true;
        console.log(`[voice:downloadFile] starting stream, total: ${(total / 1024 / 1024).toFixed(1)} MB`);
        mkdirSync(dirname(destPath), { recursive: true });
        const file = createWriteStream(destPath);
        cancelRef.cancel = () => { cancelled = true; clearTimeout(dataTimeout); req.destroy(); file.destroy(); reject(new Error("Cancelled")); };

        // Timeout: if no data received within 30s, abort
        let dataTimeout = setTimeout(() => {
          if (received === 0 && !cancelled) {
            console.error(`[voice:downloadFile] no data received in 30s, aborting`);
            req.destroy();
            file.destroy();
            reject(new Error("Download timeout: no data received"));
          }
        }, 30000);

        res.on("data", (chunk: Buffer) => {
          if (cancelled) return;
          if (firstChunk) {
            console.log(`[voice:downloadFile] first chunk received: ${chunk.length} bytes`);
            firstChunk = false;
            clearTimeout(dataTimeout);
          }
          received += chunk.length;
          onProgress(received, total);
          const now = Date.now();
          if (now - lastLogTime > 5000) {
            const pct = total > 0 ? ((received / total) * 100).toFixed(1) : "?";
            console.log(`[voice:downloadFile] progress: ${pct}% (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`);
            lastLogTime = now;
          }
        });
        res.pipe(file);
        file.on("finish", () => { clearTimeout(dataTimeout); file.close(); if (!cancelled) { console.log(`[voice:downloadFile] finished: ${destPath}`); resolve(); } });
        file.on("error", (err) => { clearTimeout(dataTimeout); file.close(); if (!cancelled) reject(err); });
      }).on("error", (err) => { console.error(`[voice:downloadFile] error:`, err.message); if (!cancelled) reject(err); });
    };
    request(url);
  });
}

/** Download file using Electron's Chromium network stack (better CDN compatibility) */
function downloadFileNet(
  url: string, destPath: string,
  onProgress: (received: number, total: number) => void,
  cancelRef: { cancel?: () => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    console.log(`[voice:downloadNet] requesting ${url}`);

    const req = net.request(url);
    cancelRef.cancel = () => { cancelled = true; req.abort(); reject(new Error("Cancelled")); };

    req.on("response", (res) => {
      const statusCode = res.statusCode;
      const total = parseInt(res.headers["content-length"] as string || "0", 10);
      console.log(`[voice:downloadNet] response status=${statusCode}, total: ${(total / 1024 / 1024).toFixed(1)} MB`);

      if (statusCode !== 200) {
        reject(new Error(`HTTP ${statusCode} for ${url}`));
        return;
      }

      mkdirSync(dirname(destPath), { recursive: true });
      const file = createWriteStream(destPath);
      let received = 0;
      let lastLogTime = Date.now();
      let firstChunk = true;

      cancelRef.cancel = () => { cancelled = true; req.abort(); file.destroy(); reject(new Error("Cancelled")); };

      res.on("data", (chunk: Buffer) => {
        if (cancelled) return;
        if (firstChunk) {
          console.log(`[voice:downloadNet] first chunk: ${chunk.length} bytes`);
          firstChunk = false;
        }
        received += chunk.length;
        file.write(chunk);
        onProgress(received, total);
        const now = Date.now();
        if (now - lastLogTime > 5000) {
          const pct = total > 0 ? ((received / total) * 100).toFixed(1) : "?";
          console.log(`[voice:downloadNet] progress: ${pct}% (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`);
          lastLogTime = now;
        }
      });

      res.on("end", () => {
        file.end(() => {
          if (!cancelled) {
            console.log(`[voice:downloadNet] finished: ${destPath} (${(received / 1024 / 1024).toFixed(1)} MB)`);
            resolve();
          }
        });
      });

      res.on("error", (err: Error) => {
        console.error(`[voice:downloadNet] stream error:`, err.message);
        file.destroy();
        if (!cancelled) reject(err);
      });
    });

    req.on("error", (err: Error) => {
      console.error(`[voice:downloadNet] request error:`, err.message);
      if (!cancelled) reject(err);
    });

    req.end();
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
    for (const modelId of Object.keys(VOICE_MODELS_REPO)) {
      statuses[modelId] = getModelStatus(modelId);
    }
    return { statuses };
  });

  ipcMain.handle("voice:download", async (_e, modelId: string) => {
    const model = VOICE_MODELS_REPO[modelId];
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

      if (model.type === "tarball") {
        // ─── Tarball download (GigaAM etc.) ───
        const tarPath = join(modelDir, "download.tar.gz");
        console.log(`[voice:download] tarball: ${model.url} → ${tarPath}`);

        let lastSendTime = Date.now();
        await downloadFileNet(model.url, tarPath, (received, total) => {
          const now = Date.now();
          if (now - lastSendTime < 500) return;
          lastSendTime = now;
          const pct = total > 0 ? Math.max(1, Math.min(99, Math.round((received / total) * 100))) : 1;
          send({ percent: pct });
        }, cancelRef);

        console.log(`[voice:download] extracting tar.gz...`);
        send({ percent: 99 });
        try {
          const tarBin = process.platform === "win32" ? join(process.env.SYSTEMROOT || "C:\\Windows", "System32", "tar.exe") : "tar";
          execFileSync(tarBin, ["-xzf", tarPath, "-C", modelDir], { timeout: 120000 });
        } catch (e: any) {
          const stderr = e.stderr?.toString?.() || "";
          console.error("[voice:download] tar stderr:", stderr);
          throw new Error("Failed to extract tar.gz: " + (stderr || e.message || e));
        }

        try { rmSync(tarPath, { force: true }); } catch { /* ignore */ }

        console.log(`[voice:download] tarball done, extracted to ${modelDir}`);
        send({ done: true });
      } else {
        // ─── HuggingFace download (Whisper, Moonshine) ───
        const allFiles = await listRepoFiles(model.repo);

        const needed = allFiles.filter((f) => {
          const p = f.path;
          if (p.endsWith(".md") || p.endsWith(".gitattributes") || p.endsWith(".gitignore")) return false;
          if (p.startsWith("onnx/") && p.endsWith(".onnx")) {
            if (p.includes("_q4") || p.includes("_q8") || p.includes("quantized")) return false;
            return true;
          }
          if (p.endsWith(".json") || p.endsWith(".txt") || p.endsWith(".model")) return true;
          if (p.startsWith("onnx/") && p.endsWith("_data")) return true;
          return false;
        });

        const totalBytes = needed.reduce((s, f) => s + f.size, 0);
        let downloadedBytes = 0;
        let lastPercent = 1;

        send({ percent: 2 });

        const repoSubDir = join(modelDir, model.repo);
        for (const file of needed) {
          const destPath = join(repoSubDir, file.path);
          if (existsSync(destPath)) {
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
      }
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
    // Dispose transcriber/gigaam if loaded for this model (releases ONNX file locks)
    if (currentModelId === modelId) {
      if (isGigaAMLoaded()) {
        await disposeGigaAM();
      } else if (transcriber) {
        try {
          if (typeof transcriber.dispose === "function") await transcriber.dispose();
        } catch { /* ignore */ }
        transcriber = null;
      }
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
    const model = VOICE_MODELS_REPO[modelId];
    if (!model) throw new Error("Unknown voice model: " + modelId);
    const status = getModelStatus(modelId);
    console.log("[voice:transcribe] model status:", status);
    if (status !== "ready") throw new Error("Model not downloaded: " + modelId);

    const dir = join(VOICE_MODELS_DIR, modelId);

    if (model.type === "tarball") {
      // ─── GigaAM / tarball models: custom ONNX pipeline ───
      if (!isGigaAMLoaded() || currentModelId !== modelId) {
        // Dispose previous model
        if (transcriber && typeof transcriber.dispose === "function") {
          try { await transcriber.dispose(); } catch { /* ignore */ }
          transcriber = null;
        }
        if (isGigaAMLoaded()) await disposeGigaAM();

        console.log("[voice:transcribe] loading GigaAM...");
        await loadGigaAM(join(dir, model.extractDir));
        currentModelId = modelId;
        console.log("[voice:transcribe] GigaAM loaded");
      }

      console.log("[voice:transcribe] GigaAM inference, samples:", audio.length, "duration:", (audio.length / 16000).toFixed(1), "s");
      const text = await transcribeGigaAM(audio);
      console.log("[voice:transcribe] result:", text);
      return text;
    }

    // ─── HuggingFace / transformers.js pipeline (Whisper, Moonshine) ───
    if (!transcriber || currentModelId !== modelId) {
      if (transcriber && typeof transcriber.dispose === "function") {
        try { await transcriber.dispose(); } catch { /* ignore */ }
      }
      if (isGigaAMLoaded()) await disposeGigaAM();

      console.log("[voice:transcribe] loading pipeline...");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hf = require("@huggingface/transformers");
      const hfDir = dirname(require.resolve("@huggingface/transformers"));
      const ortWebDistDir = pathToFileURL(
        dirname(require.resolve("onnxruntime-web", { paths: [hfDir] })) + "/"
      ).href;
      hf.env.backends.onnx.wasm.wasmPaths = ortWebDistDir;
      const { pipeline } = hf;
      console.log("[voice:transcribe] cache_dir:", dir, "repo:", model.repo);
      transcriber = await pipeline("automatic-speech-recognition", model.repo, {
        cache_dir: dir,
        local_files_only: true,
      });
      currentModelId = modelId;
      console.log("[voice:transcribe] pipeline loaded");
    }

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
