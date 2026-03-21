import type { SliceCreator } from "../types.js";
import { resolveTargetFolder } from "./sections.slice.js";

export interface IoSlice {
  exportMarkdown: () => Promise<void>;
  exportMarkdownTo: () => Promise<void>;
  importMarkdown: (targetFolderId?: string) => Promise<void>;
  importPdf: (targetFolderId?: string) => Promise<void>;
  importDroppedFiles: (filePaths: string[], targetFolderId?: string) => Promise<void>;
}

export const createIoSlice: SliceCreator<IoSlice> = (set, get) => ({
  exportMarkdown: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      await window.api.exportMarkdown(currentProject.token);
      get().addToast("success", "Exported to Markdown");
    } catch (e: any) {
      get().addToast("error", "Export failed", e.message);
    }
  },

  exportMarkdownTo: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const ok = await window.api.exportMarkdownTo(currentProject.token);
      if (ok) get().addToast("success", "Exported to Markdown");
    } catch (e: any) {
      get().addToast("error", "Export failed", e.message);
    }
  },

  importMarkdown: async (targetFolderId?: string) => {
    const { currentProject, currentSection, tree } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      let folderId = targetFolderId || resolveTargetFolder(tree, currentSection);
      if (!folderId) {
        const folder = await window.api.createSection(currentProject.token, null, "Imported", "folder");
        await get().loadTree();
        folderId = folder.id;
      }
      const fileIds = await window.api.importMarkdown(currentProject.token, folderId!);
      if (!fileIds?.length) return;
      await get().loadTree();
      await get().selectSection(fileIds[fileIds.length - 1]);
      get().addToast("success", "Markdown imported", `${fileIds.length} file(s)`);
      // Auto-generate summaries in background (best-effort, no await)
      if (get().llmApiKey) {
        for (const id of fileIds) {
          get().generateSectionSummary(id).catch(() => {});
        }
      }
    } catch (e: any) {
      get().addToast("error", "Import failed", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  importPdf: async (targetFolderId?: string) => {
    const { currentProject, currentSection, tree } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      let folderId = targetFolderId || resolveTargetFolder(tree, currentSection);
      if (!folderId) {
        const folder = await window.api.createSection(currentProject.token, null, "Imported", "folder");
        await get().loadTree();
        folderId = folder.id;
      }
      const fileId = await window.api.importPdf(currentProject.token, folderId!);
      if (!fileId) return;
      await get().loadTree();
      await get().selectSection(fileId);
      get().addToast("success", "PDF imported");
    } catch (e: any) {
      get().addToast("error", "Import failed", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  importDroppedFiles: async (filePaths: string[], targetFolderId?: string) => {
    const { currentProject, currentSection, tree } = get();
    if (!currentProject || !filePaths.length) return;

    const mdExts = new Set(["md", "markdown", "txt"]);
    const mdFiles = filePaths.filter(p => {
      const ext = p.split(".").pop()?.toLowerCase() || "";
      return mdExts.has(ext);
    });
    const pdfFiles = filePaths.filter(p => p.toLowerCase().endsWith(".pdf"));

    if (!mdFiles.length && !pdfFiles.length) {
      get().addToast("error", "Import failed", "Unsupported file type. Drop .md, .txt, or .pdf files.");
      return;
    }

    set({ treeLoading: true });
    try {
      let folderId = targetFolderId || resolveTargetFolder(tree, currentSection);
      if (!folderId) {
        const folder = await window.api.createSection(currentProject.token, null, "Imported", "folder");
        await get().loadTree();
        folderId = folder.id;
      }

      let lastId: string | null = null;
      let count = 0;

      // Import markdown files
      if (mdFiles.length) {
        const fileIds = await window.api.importMarkdownFiles(currentProject.token, folderId!, mdFiles);
        if (fileIds?.length) {
          lastId = fileIds[fileIds.length - 1];
          count += fileIds.length;
          // Auto-generate summaries
          if (get().llmApiKey) {
            for (const id of fileIds) {
              get().generateSectionSummary(id).catch(() => {});
            }
          }
        }
      }

      // Import PDF files
      for (const pdfPath of pdfFiles) {
        const fileId = await window.api.importPdfFile(currentProject.token, folderId!, pdfPath);
        if (fileId) {
          lastId = fileId;
          count++;
        }
      }

      if (count > 0) {
        await get().loadTree();
        if (lastId) await get().selectSection(lastId);
        get().addToast("success", `Imported ${count} file(s)`);
      }
    } catch (e: any) {
      get().addToast("error", "Import failed", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },
});
