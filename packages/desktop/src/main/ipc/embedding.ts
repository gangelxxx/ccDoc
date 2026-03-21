import { ipcMain } from "electron";
import { join } from "path";
import { mkdirSync, existsSync, rmSync, createWriteStream } from "fs";
import { homedir } from "os";
import https from "https";
import { LOCAL_MODELS } from "@ccdoc/core";
import { getMainWindow } from "../window";

const activeDownloads = new Map<string, () => void>(); // modelId -> cancel fn

function downloadFile(url: string, destPath: string, onProgress: (percent: number) => void, sizeHintBytes = 0, cancelRef?: { cancel?: () => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    if (cancelRef) cancelRef.cancel = () => { cancelled = true; reject(new Error("Cancelled")); };
    const request = (targetUrl: string, redirects = 0) => {
      if (cancelled) return;
      if (redirects > 10) { reject(new Error("Too many redirects")); return; }
      const opts = new URL(targetUrl);
      const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { "User-Agent": "ccdoc/1.0" } }, (res) => {
        if (cancelled) { res.resume(); return; }
        // Follow redirects (HuggingFace returns 302)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const location = res.headers.location;
          const nextUrl = location.startsWith("http") ? location : new URL(location, targetUrl).toString();
          request(nextUrl, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
          return;
        }
        const totalBytes = parseInt(res.headers["content-length"] || "0", 10) || sizeHintBytes;
        let receivedBytes = 0;
        const file = createWriteStream(destPath);
        if (cancelRef) cancelRef.cancel = () => { cancelled = true; req.destroy(); file.destroy(); reject(new Error("Cancelled")); };
        res.on("data", (chunk: Buffer) => {
          if (cancelled) return;
          receivedBytes += chunk.length;
          onProgress(totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : Math.min(99, Math.round(receivedBytes / 1_000_000)));
        });
        res.pipe(file);
        file.on("finish", () => { file.close(); if (!cancelled) resolve(); });
        file.on("error", (err) => { file.close(); if (!cancelled) reject(err); });
      }).on("error", (err) => { if (!cancelled) reject(err); });
    };
    request(url);
  });
}

export function registerEmbeddingIpc(): void {
  ipcMain.handle("embedding:status", async () => {
    const modelsDir = join(homedir(), ".ccdoc", "models");
    const statuses: Record<string, "none" | "partial" | "ready"> = {};
    for (const m of LOCAL_MODELS) {
      const allExist = m.files.every((f) => existsSync(join(modelsDir, m.id, f.name)));
      const someExist = m.files.some((f) => existsSync(join(modelsDir, m.id, f.name)));
      statuses[m.id] = allExist ? "ready" : someExist ? "partial" : "none";
    }
    return { statuses };
  });

  ipcMain.handle("embedding:download", async (_e, modelId: string) => {
    console.log("[embedding:download] start", modelId);
    const model = LOCAL_MODELS.find((m) => m.id === modelId);
    if (!model) throw new Error("Unknown model: " + modelId);
    const modelDir = join(homedir(), ".ccdoc", "models", modelId);
    mkdirSync(modelDir, { recursive: true });
    const send = (data: object) => {
      console.log("[embedding:progress]", JSON.stringify(data));
      getMainWindow()?.webContents.send("embedding:progress", { modelId, ...data });
    };
    const cancelRef: { cancel?: () => void } = {};
    activeDownloads.set(modelId, () => cancelRef.cancel?.());
    try {
      for (const file of model.files) {
        const destPath = join(modelDir, file.name);
        // Resume: skip already downloaded files
        if (existsSync(destPath)) {
          console.log("[embedding:download] skipping (exists):", file.name);
          send({ file: file.name, percent: 100 });
          continue;
        }
        console.log("[embedding:download] downloading", file.url, "->", destPath);
        send({ file: file.name, percent: 0 });
        let lastPct = -1;
        await downloadFile(file.url, destPath, (pct) => {
          if (pct !== lastPct) { lastPct = pct; send({ file: file.name, percent: pct }); }
        }, file.sizeBytes, cancelRef);
        console.log("[embedding:download] done:", file.name);
      }
      send({ done: true });
    } catch (err: any) {
      if (err.message === "Cancelled") {
        send({ cancelled: true });
      } else {
        console.error("[embedding:download] error:", err);
        send({ error: err.message || "Download failed" });
      }
    } finally {
      activeDownloads.delete(modelId);
    }
  });

  ipcMain.handle("embedding:cancel", (_e, modelId: string) => {
    activeDownloads.get(modelId)?.();
  });

  ipcMain.handle("embedding:delete", async (_e, modelId: string) => {
    const modelDir = join(homedir(), ".ccdoc", "models", modelId);
    if (existsSync(modelDir)) rmSync(modelDir, { recursive: true });
  });
}
