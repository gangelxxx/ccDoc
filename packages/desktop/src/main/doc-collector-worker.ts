/**
 * Doc Collector Worker — collects and converts document sections to plain text
 * in a dedicated thread to keep the main Electron process responsive.
 *
 * Supports two modes:
 * - "collect": all non-folder, non-deleted sections (full index)
 * - "collect-ids": only specific section IDs (incremental update)
 */
import { parentPort } from "worker_threads";
import { openProjectDb, SectionsService } from "@ccdoc/core";

if (!parentPort) throw new Error("Must run as worker thread");

interface DocSectionInput {
  id: string;
  title: string;
  path: string;
  content: string;
  type: string;
}

type Message =
  | { type: "collect"; token: string }
  | { type: "collect-ids"; token: string; ids: string[] };

parentPort.on("message", async (msg: Message) => {
  if (msg.type !== "collect" && msg.type !== "collect-ids") return;

  try {
    const db = await openProjectDb(msg.token);
    try {
      const sections = new SectionsService(db);
      const result: DocSectionInput[] = [];

      if (msg.type === "collect") {
        const allSections = await sections.listAll();
        for (const sec of allSections) {
          if (sec.type === "folder" || sec.deleted_at) continue;
          try {
            const content = await sections.getContent(sec.id, "plain");
            if (content && typeof content === "string" && content.length > 0) {
              result.push({ id: sec.id, title: sec.title, path: sec.title, content, type: sec.type });
            }
          } catch { /* skip broken section */ }
        }
      } else {
        for (const id of msg.ids) {
          try {
            const content = await sections.getContent(id, "plain");
            const sec = await sections.getById(id);
            if (sec && content && typeof content === "string" && content.length > 0) {
              result.push({ id: sec.id, title: sec.title, path: sec.title, content, type: sec.type });
            }
          } catch { /* skip broken section */ }
        }
      }

      parentPort!.postMessage({ type: "done", sections: result });
    } finally {
      db.close();
    }
  } catch (err: any) {
    parentPort!.postMessage({ type: "error", error: err?.message ?? String(err) });
  }
});

parentPort.postMessage({ type: "ready" });
