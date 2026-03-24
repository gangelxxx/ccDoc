import { ipcMain } from "electron";
import { getProjectServices, getProjectsService, getSearchService } from "../services";

export function registerSearchIpc(): void {
  // Hybrid search (FTS5 + embeddings via FindService)
  ipcMain.handle("search:fts", async (_e, token: string, query: string, limit?: number) => {
    const { find } = await getProjectServices(token);
    return find.search(query, limit ?? 20);
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
