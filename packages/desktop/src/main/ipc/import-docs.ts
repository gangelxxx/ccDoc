import { ipcMain } from "electron";
import { readFileSync, existsSync } from "fs";
import { readdir, stat as fsStat, unlink as fsUnlink } from "fs/promises";
import { join, basename, extname, resolve } from "path";
import { prosemirrorToMarkdown } from "@ccdoc/core";
import { getProjectServices, getProjectsService, trackBgTask, suppressExternalChange } from "../services";
import { getMainWindow } from "../window";

const SCAN_EXCLUDED = new Set(["node_modules", ".git", ".ccdoc", "dist", "build", ".next", "vendor", "__pycache__", ".vscode", ".idea", ".svn", "coverage", ".nyc_output"]);
const SCAN_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export function registerImportDocsIpc(): void {
  ipcMain.handle("import-docs:scan", async (_e, token: string) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");

    const results: { relativePath: string; absolutePath: string; sizeBytes: number }[] = [];

    async function walk(dir: string, relBase: string) {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SCAN_EXCLUDED.has(entry.name)) continue;
          await walk(join(dir, entry.name), relBase ? join(relBase, entry.name) : entry.name);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (SCAN_EXTENSIONS.has(ext)) {
            const abs = join(dir, entry.name);
            try {
              const st = await fsStat(abs);
              results.push({ relativePath: relBase ? join(relBase, entry.name) : entry.name, absolutePath: abs, sizeBytes: st.size });
            } catch { /* skip unreadable */ }
          }
        }
      }
      getMainWindow()?.webContents.send("import-docs:progress", { phase: "scan", found: results.length });
    }

    await walk(project.path, "");
    return results;
  });

  ipcMain.handle("import-docs:import", async (_e, token: string, files: { absolutePath: string; relativePath: string }[], folderId: string) => {
    console.log("[import-docs:import] start", { token, folderId, fileCount: files.length });
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    console.log("[import-docs:import] got services");
    const results: { relativePath: string; absolutePath: string; fileId: string; success: boolean; error?: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      // Send progress BEFORE processing so UI shows current file name
      getMainWindow()?.webContents.send("import-docs:progress", { phase: "import", current: i, total: files.length, file: files[i].relativePath });
      console.log(`[import-docs:import] file ${i + 1}/${files.length}: ${files[i].relativePath}`);
      try {
        const content = readFileSync(files[i].absolutePath, "utf-8");
        const fileName = basename(files[i].relativePath, extname(files[i].relativePath));
        const fileId = await import_.importMarkdown(folderId, fileName, content);
        results.push({ relativePath: files[i].relativePath, absolutePath: files[i].absolutePath, fileId, success: true });
      } catch (err: any) {
        console.error(`[import-docs:import] error:`, err.message);
        results.push({ relativePath: files[i].relativePath, absolutePath: files[i].absolutePath, fileId: "", success: false, error: err.message });
      }
      getMainWindow()?.webContents.send("import-docs:progress", { phase: "import", current: i + 1, total: files.length, file: files[i].relativePath });
    }
    console.log("[import-docs:import] all done, results:", results.length);
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after docs import:", err));
    return results;
  });

  ipcMain.handle("import-docs:verify", async (_e, token: string, importResults: { relativePath: string; absolutePath: string; fileId: string }[]) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");
    const { sections } = await getProjectServices(token);

    // Collect set of all imported relative paths for cross-reference checks
    const importedPaths = new Set(importResults.map(r => r.relativePath.replace(/\\/g, "/")));

    function countStats(text: string) {
      const codeBlocks = (text.match(/^```/gm) || []).length / 2;
      // Strip fenced code blocks so regexes don't match inside them
      const normalized = text.replace(/\r\n/g, "\n");
      const stripped = normalized.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*/gm, "");
      const atxHeadings = (stripped.match(/^#{1,6}\s/gm) || []).length;
      // Setext headings: non-empty line followed by a line of only = or -
      const setextHeadings = (stripped.match(/^[^\n]+\n[=-]+\s*$/gm) || []).length;
      const headings = atxHeadings + setextHeadings;
      const links = (stripped.match(/\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
      const images = (stripped.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
      const charCount = text.replace(/\s+/g, "").length;
      return { headings, codeBlocks: Math.floor(codeBlocks), links, images, charCount };
    }

    function extractLinks(text: string, fileRelPath: string) {
      const linkRegex = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
      const results: { href: string; isImage: boolean; type: string; status: string; detail?: string }[] = [];
      let m;
      while ((m = linkRegex.exec(text)) !== null) {
        const isImage = m[1] === "!";
        const href = m[3];

        if (href.startsWith("http://") || href.startsWith("https://")) {
          results.push({ href, isImage, type: "external", status: "ok" });
        } else if (href.startsWith("#")) {
          results.push({ href, isImage, type: "anchor", status: "ok" });
        } else if (href.startsWith("mailto:")) {
          results.push({ href, isImage, type: "external", status: "ok" });
        } else {
          // Relative path
          const cleanHref = href.split("#")[0].split("?")[0];
          const fileDir = fileRelPath.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
          const resolvedRel = join(fileDir, cleanHref).replace(/\\/g, "/");
          const resolvedAbs = resolve(project!.path, resolvedRel);

          if (isImage) {
            const found = existsSync(resolvedAbs);
            results.push({ href, isImage, type: "image", status: found ? "warning" : "broken", detail: found ? "Файл найден, но не будет доступен в приложении" : "Файл не найден" });
          } else {
            // Check if target is also being imported
            const normalized = resolvedRel.replace(/^\.\//, "");
            if (importedPaths.has(normalized)) {
              results.push({ href, isImage, type: "internal_md", status: "ok", detail: "Тоже импортируется" });
            } else if (existsSync(resolvedAbs)) {
              results.push({ href, isImage, type: "internal_md", status: "warning", detail: "Файл не импортируется" });
            } else {
              results.push({ href, isImage, type: "internal_md", status: "broken", detail: "Файл не найден" });
            }
          }
        }
      }
      return results;
    }

    const verifyResults = [];
    for (let i = 0; i < importResults.length; i++) {
      const r = importResults[i];
      try {
        const originalText = readFileSync(r.absolutePath, "utf-8");
        const originalStats = countStats(originalText);

        // Read back imported content
        const { file, sections: fileSections } = await sections.getFileWithSections(r.fileId);
        let reconstructed = "";
        try {
          const fileDoc = JSON.parse(file.content);
          reconstructed += prosemirrorToMarkdown(fileDoc);
        } catch { /* empty content */ }

        function collectSections(nodes: any[], depth: number) {
          const prefix = "#".repeat(Math.min(depth, 6));
          for (const node of nodes) {
            reconstructed += "\n\n" + prefix + " " + node.title;
            try {
              const doc = JSON.parse(node.content);
              const md = prosemirrorToMarkdown(doc);
              if (md) reconstructed += "\n\n" + md;
            } catch { /* empty content */ }
            if (node.children?.length) collectSections(node.children, depth + 1);
          }
        }
        collectSections(fileSections, 2);

        const importedStats = countStats(reconstructed);

        // Debug: log mismatches
        if (originalStats.headings !== importedStats.headings) {
          console.log(`[verify] MISMATCH ${r.relativePath}: orig=${originalStats.headings} imp=${importedStats.headings}`);
          console.log(`[verify] reconstructed:\n${reconstructed.slice(0, 2000)}`);
        }

        const charDiff = originalStats.charCount > 0 ? Math.abs(originalStats.charCount - importedStats.charCount) / originalStats.charCount : 0;
        const match = originalStats.headings === importedStats.headings && charDiff < 0.1;
        const links = extractLinks(originalText, r.relativePath);
        const brokenLinks = links.filter(l => l.status === "broken").length;
        const warnings: string[] = [];
        if (!match) warnings.push(`Расхождение контента: оригинал ${originalStats.charCount} симв., импорт ${importedStats.charCount} симв.`);
        if (originalStats.headings !== importedStats.headings) warnings.push(`Заголовков: оригинал ${originalStats.headings}, импорт ${importedStats.headings}`);
        if (brokenLinks > 0) warnings.push(`${brokenLinks} ссылок не найдено`);

        verifyResults.push({
          relativePath: r.relativePath,
          fileId: r.fileId,
          stats: { original: originalStats, imported: importedStats },
          match,
          links,
          brokenLinks,
          warnings,
        });
      } catch (err: any) {
        verifyResults.push({
          relativePath: r.relativePath,
          fileId: r.fileId,
          stats: { original: { headings: 0, codeBlocks: 0, links: 0, images: 0, charCount: 0 }, imported: { headings: 0, codeBlocks: 0, links: 0, images: 0, charCount: 0 } },
          match: false,
          links: [],
          brokenLinks: 0,
          warnings: [`Ошибка верификации: ${err.message}`],
        });
      }
      getMainWindow()?.webContents.send("import-docs:progress", { phase: "verify", current: i + 1, total: importResults.length });
    }
    return verifyResults;
  });

  ipcMain.handle("import-docs:cleanup", async (_e, token: string, filePaths: string[]) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");
    const projectRoot = resolve(project.path);

    const deleted: string[] = [];
    const errors: string[] = [];
    for (let i = 0; i < filePaths.length; i++) {
      const resolved = resolve(filePaths[i]);
      if (!resolved.startsWith(projectRoot + "\\") && !resolved.startsWith(projectRoot + "/")) {
        errors.push(`${filePaths[i]}: path outside project directory`);
        continue;
      }
      try {
        await fsUnlink(resolved);
        deleted.push(filePaths[i]);
      } catch (err: any) {
        errors.push(`${filePaths[i]}: ${err.message}`);
      }
      getMainWindow()?.webContents.send("import-docs:progress", { phase: "cleanup", current: i + 1, total: filePaths.length });
    }
    return { deleted, errors };
  });
}
