import { ipcMain, clipboard } from "electron";
import { getUserService } from "../services";
import type { SectionType, OutputFormat } from "@ccdoc/core";

export function registerUserIpc(): void {
  ipcMain.handle("user:tree", async () => {
    const svc = getUserService();
    return svc.getTree();
  });

  ipcMain.handle("user:rootTree", async () => {
    const svc = getUserService();
    return svc.getRootTreeNodes();
  });

  ipcMain.handle("user:childrenTree", async (_e, parentId: string) => {
    const svc = getUserService();
    return svc.getChildTreeNodes(parentId);
  });

  ipcMain.handle("user:get", async (_e, id: string) => {
    const svc = getUserService();
    return svc.getById(id);
  });

  ipcMain.handle("user:content", async (_e, id: string, format?: OutputFormat) => {
    const svc = getUserService();
    return svc.getContent(id, format);
  });

  ipcMain.handle("user:parentChain", async (_e, id: string) => {
    const svc = getUserService();
    return svc.getParentChain(id);
  });

  ipcMain.handle("user:create", async (_e, parentId: string | null, title: string, type: SectionType, icon?: string | null, content?: string) => {
    const svc = getUserService();
    return svc.create({ parentId, title, type, icon, content });
  });

  ipcMain.handle("user:update", async (_e, id: string, title: string, content: string) => {
    const svc = getUserService();
    await svc.updateRaw(id, title, content);
  });

  ipcMain.handle("user:updateMarkdown", async (_e, id: string, title: string, markdown: string) => {
    const svc = getUserService();
    await svc.update(id, title, markdown);
  });

  ipcMain.handle("user:icon", async (_e, id: string, icon: string | null) => {
    const svc = getUserService();
    await svc.updateIcon(id, icon);
  });

  ipcMain.handle("user:move", async (_e, id: string, newParentId: string | null, afterId: string | null) => {
    const svc = getUserService();
    await svc.move(id, newParentId, afterId);
  });

  ipcMain.handle("user:duplicate", async (_e, id: string) => {
    const svc = getUserService();
    return svc.duplicate(id);
  });

  ipcMain.handle("user:delete", async (_e, id: string) => {
    const svc = getUserService();
    await svc.softDelete(id);
  });

  ipcMain.handle("user:restore", async (_e, id: string) => {
    const svc = getUserService();
    await svc.restore(id);
  });

  ipcMain.handle("user:todos", async () => {
    const svc = getUserService();
    return svc.getTodos();
  });

  ipcMain.handle("user:search", async (_e, query: string, limit?: number) => {
    const svc = getUserService();
    return svc.search(query, limit);
  });

  ipcMain.handle("user:getFileWithSections", async (_e, fileId: string) => {
    const svc = getUserService();
    return svc.getFileWithSections(fileId);
  });

  ipcMain.handle("user:getSectionChildren", async (_e, parentId: string) => {
    const svc = getUserService();
    return svc.getSectionChildren(parentId);
  });

  ipcMain.handle("user:copy-as-markdown", async (_e, id: string) => {
    const svc = getUserService();
    const markdown = await svc.buildSectionMarkdown(id);
    clipboard.writeText(markdown);
  });

  // History
  ipcMain.handle("user:history:commit", async (_e, message: string) => {
    const svc = getUserService();
    const allSections = await svc.sections.listAll();
    return svc.history.commit(allSections, message);
  });

  ipcMain.handle("user:history:log", async () => {
    const svc = getUserService();
    return svc.history.log();
  });

  ipcMain.handle("user:history:restore", async (_e, commitId: string) => {
    const svc = getUserService();
    await svc.history.restore(commitId, svc.sections);
  });
}
