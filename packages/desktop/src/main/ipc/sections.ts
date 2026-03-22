import { ipcMain, clipboard } from "electron";
import { getProjectServices, suppressExternalChange } from "../services";
import type { OutputFormat, SectionType } from "@ccdoc/core";

export function registerSectionsIpc(): void {
  ipcMain.handle("sections:tree", async (_e, token: string) => {
    const { sections } = await getProjectServices(token);
    const tree = await sections.getTree();
    console.log("[sections:tree] count:", JSON.stringify(tree).length, "root items:", tree.length);
    return tree;
  });

  ipcMain.handle("sections:get", async (_e, token: string, id: string) => {
    const t0 = performance.now();
    const { sections } = await getProjectServices(token);
    const result = await sections.getById(id);
    console.log(`[perf] sections:get ${id.substring(0, 8)} +${(performance.now() - t0).toFixed(0)}ms contentLen=${result?.content?.length ?? 0}`);
    return result;
  });

  ipcMain.handle("sections:getContent", async (_e, token: string, id: string, format: OutputFormat) => {
    const { sections } = await getProjectServices(token);
    return sections.getContent(id, format);
  });

  ipcMain.handle("sections:create", async (_e, token: string, parentId: string | null, title: string, type: SectionType, icon?: string | null, content?: string) => {
    console.log("[sections:create]", { token, parentId, title, type, icon, hasContent: !!content, contentLen: content?.length });
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    const result = await sections.create({ parentId, title, type, icon, content });
    console.log("[sections:create] result:", result?.id, result?.title, "content_len:", result?.content?.length);
    if (result) {
      index.indexSection(result).catch((err) => console.warn("[index] index after create failed:", err));
    }
    return result;
  });

  ipcMain.handle("sections:updateIcon", async (_e, token: string, id: string, icon: string | null) => {
    suppressExternalChange(token);
    const { sections } = await getProjectServices(token);
    await sections.updateIcon(id, icon);
  });

  ipcMain.handle("sections:update", async (_e, token: string, id: string, title: string, content: string) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    const before = await sections.getById(id);
    await sections.updateRaw(id, title, content);
    const updated = await sections.getById(id);
    if (updated) {
      index.indexSection(updated).catch((err) => console.warn("[index] index after update failed:", err));
      if (before && before.title !== title) {
        index.reindexDescendants(id).catch(err => console.warn("[index] title change descendants:", err));
      }
    }
  });

  ipcMain.handle("sections:updateMarkdown", async (_e, token: string, id: string, title: string, markdown: string) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    const before = await sections.getById(id);
    await sections.update(id, title, markdown);
    const updated = await sections.getById(id);
    if (updated) {
      index.indexSection(updated).catch(err => console.warn("[index] updateMd:", err));
      if (before && before.title !== title) {
        index.reindexDescendants(id).catch(err => console.warn("[index] updateMd descendants:", err));
      }
    }
  });

  ipcMain.handle("sections:move", async (_e, token: string, id: string, newParentId: string | null, afterId: string | null) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    await sections.move(id, newParentId, afterId);
    const moved = await sections.getById(id);
    if (moved) {
      index.indexSection(moved).catch(err => console.warn("[index] move:", err));
      index.reindexDescendants(id).catch(err => console.warn("[index] move descendants:", err));
    }
  });

  ipcMain.handle("sections:duplicate", async (_e, token: string, id: string) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    const result = await sections.duplicate(id);
    if (result) {
      index.indexSection(result).catch(err => console.warn("[index] duplicate:", err));
      index.reindexDescendants(result.id).catch(err => console.warn("[index] dup descendants:", err));
    }
    return result;
  });

  ipcMain.handle("sections:convertIdeaToKanban", async (_e, token: string, ideaId: string, columnNames?: { backlog: string; inProgress: string; done: string }) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    const result = await sections.convertIdeaToKanban(ideaId, columnNames);
    if (result) {
      index.indexSection(result).catch((err) => console.warn("[index] convertIdeaToKanban:", err));
    }
    return result;
  });

  ipcMain.handle("sections:delete", async (_e, token: string, id: string) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    await sections.softDelete(id);
    index.removeSection(id).catch((err) => console.warn("[index] remove after delete failed:", err));
  });

  ipcMain.handle("sections:restore", async (_e, token: string, id: string) => {
    suppressExternalChange(token);
    const { sections, index } = await getProjectServices(token);
    await sections.restore(id);
    const restored = await sections.getById(id);
    if (restored) {
      index.indexSection(restored).catch(err => console.warn("[index] restore:", err));
    }
  });

  ipcMain.handle("sections:getFileWithSections", async (_e, token: string, fileId: string) => {
    const t0 = performance.now();
    const { sections } = await getProjectServices(token);
    const result = await sections.getFileWithSections(fileId);
    console.log(`[perf] sections:getFileWithSections ${fileId.substring(0, 8)} +${(performance.now() - t0).toFixed(0)}ms sections=${JSON.stringify(result).length} chars`);
    return result;
  });

  ipcMain.handle("sections:getSectionChildren", async (_e, token: string, parentId: string) => {
    const { sections } = await getProjectServices(token);
    return sections.getSectionChildren(parentId);
  });

  ipcMain.handle("sections:setSummary", async (_e, token: string, id: string, summary: string | null) => {
    suppressExternalChange(token);
    const { sections } = await getProjectServices(token);
    await sections.setSummary(id, summary);
  });

  ipcMain.handle("sections:copy-as-markdown", async (_e, token: string, id: string) => {
    const { sections } = await getProjectServices(token);
    const markdown = await sections.buildSectionMarkdown(id);
    clipboard.writeText(markdown);
  });
}
