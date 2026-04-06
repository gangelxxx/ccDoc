import { ipcMain } from "electron";
import { getProjectServices, getProjectsService, getSearchService, getUserService } from "../services";

export function registerSearchIpc(): void {
  // Hybrid search (FTS5 + embeddings via FindService)
  ipcMain.handle("search:fts", async (_e, token: string, query: string, limit?: number) => {
    const { find } = await getProjectServices(token);
    const userService = getUserService();
    const effectiveLimit = limit ?? 20;

    // Search both DBs in parallel
    const [projectResults, userResults] = await Promise.all([
      find.search(query, effectiveLimit),
      userService.search(query, effectiveLimit),
    ]);

    // Tag results with source
    const tagged = [
      ...userResults.map(r => ({ ...r, source: "user" as const })),
      ...projectResults.map(r => ({ ...r, source: "project" as const })),
    ];

    // Sort by score descending, take top limit
    tagged.sort((a, b) => b.score - a.score);
    return tagged.slice(0, effectiveLimit);
  });

  // Search (MiniSearch, legacy)
  ipcMain.handle("search:query", async (_e, token: string, query: string) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) return [];
    const { sections } = await getProjectServices(token);
    const allSections = await sections.listAll();
    getSearchService().indexAll(allSections, token, project.name);
    return getSearchService().search(query, token);
  });
}
