/**
 * FTS Reindex Worker — runs full-text search reindexing in a dedicated thread
 * to keep the main Electron process responsive.
 *
 * Opens its own DB connection, reads sections, extracts text, writes FTS.
 * No embedding work happens here (handled by the semantic worker separately).
 */
import { parentPort } from "worker_threads";
import { openProjectDb, IndexService } from "@ccdoc/core";

if (!parentPort) throw new Error("Must run as worker thread");

parentPort.on("message", async (msg: { type: string; token: string }) => {
  if (msg.type !== "reindex") return;

  try {
    const db = await openProjectDb(msg.token);
    try {
      // No embedding model → FTS-only reindex
      const index = new IndexService(db);
      await index.reindexAll();
    } finally {
      db.close();
    }
    parentPort!.postMessage({ type: "done" });
  } catch (err: any) {
    parentPort!.postMessage({ type: "error", error: err?.message ?? String(err) });
  }
});

parentPort.postMessage({ type: "ready" });
