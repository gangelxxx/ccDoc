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

    let folderId = targetFolderId || resolveTargetFolder(tree, currentSection);
    if (!folderId) {
      const folder = await window.api.createSection(currentProject.token, null, "Imported", "folder");
      await get().loadTree();
      folderId = folder.id;
    }

    // Fire and forget — PDF processing runs in background (tracked in status bar)
    window.api.importPdf(currentProject.token, folderId!)
      .then(async (fileId) => {
        if (!fileId) return; // user cancelled dialog
        await get().loadTree();
        await get().selectSection(fileId);
        get().addToast("success", "PDF imported");
      })
      .catch((e: any) => {
        get().addToast("error", "Import failed", e.message);
      });
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

    // Resolve target folder
    let folderId = targetFolderId || resolveTargetFolder(tree, currentSection);
    if (!folderId) {
      const folder = await window.api.createSection(currentProject.token, null, "Imported", "folder");
      await get().loadTree();
      folderId = folder.id;
    }

    // Import markdown files (synchronous — fast)
    if (mdFiles.length) {
      set({ treeLoading: true });
      try {
        const fileIds = await window.api.importMarkdownFiles(currentProject.token, folderId!, mdFiles);
        if (fileIds?.length) {
          await get().loadTree();
          await get().selectSection(fileIds[fileIds.length - 1]);
          get().addToast("success", `Imported ${fileIds.length} file(s)`);
          if (get().llmApiKey) {
            for (const id of fileIds) {
              get().generateSectionSummary(id).catch(() => {});
            }
          }
        }
      } catch (e: any) {
        get().addToast("error", "Import failed", e.message);
      } finally {
        set({ treeLoading: false });
      }
    }

    // Import PDF files (non-blocking — runs in background, tracked in status bar)
    for (const pdfPath of pdfFiles) {
      window.api.importPdfFile(currentProject.token, folderId!, pdfPath)
        .then(async (fileId) => {
          if (fileId) {
            await get().loadTree();
            await get().selectSection(fileId);
            get().addToast("success", "PDF imported");
          }
        })
        .catch((e: any) => {
          get().addToast("error", "PDF import failed", e.message);
        });
    }
  },
});
