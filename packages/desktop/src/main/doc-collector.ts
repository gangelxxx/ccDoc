/**
 * Spawn a one-shot worker thread to collect doc sections off the main thread.
 */
import { join } from "path";
import { Worker } from "worker_threads";
import type { DocSectionInput } from "./semantic-worker";

function runCollectorWorker(message: Record<string, unknown>): Promise<DocSectionInput[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(join(__dirname, "doc-collector-worker.js"));
    let settled = false;

    const finish = (err?: Error, data?: DocSectionInput[]) => {
      if (settled) return;
      settled = true;
      w.terminate().catch(() => {});
      err ? reject(err) : resolve(data ?? []);
    };

    w.on("message", (msg: { type: string; sections?: DocSectionInput[]; error?: string }) => {
      if (msg.type === "ready") {
        w.postMessage(message);
      } else if (msg.type === "done") {
        finish(undefined, msg.sections ?? []);
      } else if (msg.type === "error") {
        finish(new Error(msg.error));
      }
    });

    w.on("error", (err) => finish(err));
    w.on("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`Doc collector worker exited with code ${code}`));
    });
  });
}

/** Collect all non-folder, non-deleted sections (full index). */
export function collectDocSectionsInWorker(token: string): Promise<DocSectionInput[]> {
  return runCollectorWorker({ type: "collect", token });
}

/** Collect only specific sections by ID (incremental update). */
export function collectDocSectionsByIdsInWorker(token: string, ids: string[]): Promise<DocSectionInput[]> {
  return runCollectorWorker({ type: "collect-ids", token, ids });
}
