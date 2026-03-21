import { ipcMain } from "electron";
import { getProjectServices, suppressExternalChange } from "../services";

export function registerHistoryIpc(): void {
  ipcMain.handle("history:commit", async (_e, token: string, message: string) => {
    const { sections, history } = await getProjectServices(token);
    const allSections = await sections.listAll();
    return history.commit(allSections, message);
  });

  ipcMain.handle("history:getDiffIds", async (_e, token: string, commitOid: string) => {
    const { sections, history } = await getProjectServices(token);
    const allSections = await sections.listAll();
    return history.getDiffIds(commitOid, allSections);
  });

  ipcMain.handle("history:getDiff", async (_e, token: string) => {
    const { sections, history } = await getProjectServices(token);
    const allSections = await sections.listAll();
    return history.getDiff(allSections);
  });

  ipcMain.handle("history:log", async (_e, token: string) => {
    const { history } = await getProjectServices(token);
    return history.log();
  });

  ipcMain.handle("history:restore", async (_e, token: string, commitId: string) => {
    suppressExternalChange(token);
    const { sections, history } = await getProjectServices(token);
    await history.restore(commitId, sections);
  });

  ipcMain.handle("history:delete", async (_e, token: string, commitId: string) => {
    const { history } = await getProjectServices(token);
    await history.deleteCommit(commitId);
  });

  ipcMain.handle("history:getStructure", async (_e, token: string, commitId: string) => {
    const { history } = await getProjectServices(token);
    return history.getStructureAtVersion(commitId);
  });

  ipcMain.handle("history:getSectionAtVersion", async (_e, token: string, sectionId: string, commitId: string) => {
    const { history } = await getProjectServices(token);
    return history.getSectionAtVersion(sectionId, commitId);
  });

  ipcMain.handle("history:getAllContents", async (_e, token: string, commitId: string) => {
    const { history } = await getProjectServices(token);
    return history.getAllContentsAtVersion(commitId);
  });

  ipcMain.handle("history:search", async (_e, token: string, commitId: string, query: string) => {
    const { history } = await getProjectServices(token);
    return history.searchAtVersion(commitId, query);
  });
}
