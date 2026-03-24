import { ipcMain } from "electron";
import { KnowledgeGraphService, SectionsRepo } from "@ccdoc/core";
import type { KGExternalNode } from "@ccdoc/core";
import { getProjectServices, getEmbeddingManager } from "../services";
import { getMainWindow } from "../window";
import type { SettingsService } from "../services/settings.service";

// Debounce map for syncNode calls per project
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function buildSessionNodes(settingsService: SettingsService): KGExternalNode[] {
  const sessions: any[] = settingsService.getSessions();
  const nodes: KGExternalNode[] = [];

  for (const session of sessions) {
    if (!Array.isArray(session.messages)) continue;
    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (typeof msg.content !== "string") continue;
      if (msg.content.length <= 50) continue;
      nodes.push({
        id: `session:${session.id}:${i}`,
        nodeType: "session",
        label: msg.content.split("\n")[0].slice(0, 80) || "Session",
        summary: msg.content.slice(0, 200),
        textForEmbedding: msg.content,
      });
    }
  }

  return nodes;
}

export function registerKnowledgeGraphIpc(settingsService: SettingsService): void {
  // Full analysis — builds the graph from scratch
  ipcMain.handle("kg:analyze", async (_e, token: string, sources?: { ideas?: boolean; docs?: boolean; sections?: boolean; sessions?: boolean }) => {
    const { db, embeddingRepo } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const model = getEmbeddingManager()?.getProvider() ?? null;
    const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
    const win = getMainWindow();
    const externalNodes = !sources || sources.sessions ? buildSessionNodes(settingsService) : [];
    const result = await kgService.analyze({ sources }, (phase, current, total) => {
      win?.webContents.send("kg:progress", { phase, current, total });
    }, externalNodes);

    return result;
  });

  // Get full graph data
  ipcMain.handle("kg:get", async (_e, token: string) => {
    const { db, embeddingRepo } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const model = getEmbeddingManager()?.getProvider() ?? null;
    const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
    return kgService.getGraph();
  });

  // Get neighbourhood of a node
  ipcMain.handle("kg:getNeighbourhood", async (_e, token: string, sectionId: string) => {
    const { db, embeddingRepo } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const model = getEmbeddingManager()?.getProvider() ?? null;
    const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
    return kgService.getNeighbourhood(sectionId);
  });

  // Incremental node sync (debounced 2.5s per token+sectionId, fire-and-forget)
  ipcMain.handle("kg:syncNode", async (_e, token: string, sectionId: string) => {
    const key = `${token}:${sectionId}`;
    if (syncTimers.has(key)) clearTimeout(syncTimers.get(key)!);
    syncTimers.set(key, setTimeout(async () => {
      syncTimers.delete(key);
      try {
        const { db, embeddingRepo } = await getProjectServices(token);
        const sectionsRepo = new SectionsRepo(db);
        const model = getEmbeddingManager()?.getProvider() ?? null;
        const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
        await kgService.syncNode(sectionId);
        getMainWindow()?.webContents.send("kg:nodeUpdated", sectionId);
      } catch (err) {
        console.warn("[kg:syncNode] error:", err);
      }
    }, 2500));
    // Resolve immediately — actual work is deferred
  });

  // Get related sections (for context enrichment)
  ipcMain.handle("kg:getRelated", async (_e, token: string, sectionId: string, limit?: number) => {
    const { db, embeddingRepo } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const model = getEmbeddingManager()?.getProvider() ?? null;
    const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
    return kgService.getRelatedSections(sectionId, limit ?? 5);
  });

  // Find orphan nodes
  ipcMain.handle("kg:findOrphans", async (_e, token: string, nodeType?: string) => {
    const { db, embeddingRepo } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const model = getEmbeddingManager()?.getProvider() ?? null;
    const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
    return kgService.findOrphans(nodeType);
  });

  // Graph statistics
  ipcMain.handle("kg:stats", async (_e, token: string) => {
    const { db, embeddingRepo } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const model = getEmbeddingManager()?.getProvider() ?? null;
    const kgService = new KnowledgeGraphService(db, sectionsRepo, embeddingRepo, model);
    return kgService.getStats();
  });

  // Save view settings to knowledge_graph section content
  ipcMain.handle("kg:saveViewSettings", async (_e, token: string, sectionId: string, settings: string) => {
    const { db } = await getProjectServices(token);
    const sectionsRepo = new SectionsRepo(db);
    const section = await sectionsRepo.getById(sectionId);
    if (!section) throw new Error(`Section ${sectionId} not found`);
    await sectionsRepo.updateContent(sectionId, section.title, settings);
  });
}
