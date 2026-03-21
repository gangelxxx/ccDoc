import { ipcMain } from "electron";
import { getProjectServices, getProjectsService, getSearchService } from "../services";

export function registerSearchIpc(): void {
  // FTS Search
  ipcMain.handle("search:fts", async (_e, token: string, query: string, limit?: number) => {
    const { fts } = await getProjectServices(token);
    return fts.search(query, limit);
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
