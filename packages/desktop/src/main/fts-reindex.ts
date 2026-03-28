/**
 * Spawn a one-shot worker thread to run FTS reindexAll off the main thread.
 */
import { join } from "path";
import { Worker } from "worker_threads";

export function reindexFtsInWorker(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = new Worker(join(__dirname, "fts-worker.js"));
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      w.terminate().catch(() => {});
      err ? reject(err) : resolve();
    };

    w.on("message", (msg: { type: string; error?: string }) => {
      if (msg.type === "ready") {
        w.postMessage({ type: "reindex", token });
      } else if (msg.type === "done") {
        finish();
      } else if (msg.type === "error") {
        finish(new Error(msg.error));
      }
    });

    w.on("error", (err) => finish(err));
    w.on("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`FTS worker exited with code ${code}`));
    });
  });
}
