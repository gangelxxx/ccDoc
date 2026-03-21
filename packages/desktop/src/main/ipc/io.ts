import { ipcMain, dialog, nativeImage } from "electron";
import { readFileSync } from "fs";
import { basename, extname } from "path";
import { getProjectServices, getProjectsService, trackBgTask, suppressExternalChange } from "../services";
import { getMainWindow } from "../window";

interface PdfImage {
  dataUri: string;
  width: number;
  height: number;
}

interface PdfPage {
  pageNum: number;
  text: string;
  images: PdfImage[];
}

function rgbaToPngDataUri(data: Uint8ClampedArray, width: number, height: number): string {
  // nativeImage.createFromBitmap expects BGRA, pdfjs gives RGBA — swap R↔B
  const bgra = Buffer.from(data);
  for (let i = 0; i < bgra.length; i += 4) {
    const r = bgra[i];
    bgra[i] = bgra[i + 2];
    bgra[i + 2] = r;
  }
  const img = nativeImage.createFromBitmap(bgra, { width, height });
  return `data:image/png;base64,${img.toPNG().toString("base64")}`;
}

function rgbToPngDataUri(data: Uint8ClampedArray, width: number, height: number): string {
  // Convert RGB → BGRA for nativeImage
  const bgra = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    bgra[j] = data[i + 2];     // B
    bgra[j + 1] = data[i + 1]; // G
    bgra[j + 2] = data[i];     // R
    bgra[j + 3] = 255;         // A
  }
  const img = nativeImage.createFromBitmap(bgra, { width, height });
  return `data:image/png;base64,${img.toPNG().toString("base64")}`;
}

const MIN_IMG_PIXELS = 400; // skip tiny icons/decorations (< 20x20)

async function extractPdfContent(buffer: Buffer): Promise<PdfPage[]> {
  console.log("[pdf] starting extraction, buffer size:", buffer.length);
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  console.log("[pdf] document loaded, pages:", doc.numPages);
  const pages: PdfPage[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    // Extract text
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(" ");
    console.log(`[pdf] page ${i} — text items: ${textContent.items.length}, text length: ${text.length}`);

    // Extract images
    const images: PdfImage[] = [];
    const ops = await page.getOperatorList();
    const seenImgNames = new Set<string>();

    let imgOpsCount = 0;
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (ops.fnArray[k] !== pdfjsLib.OPS.paintImageXObject) continue;
      imgOpsCount++;
      const imgName = ops.argsArray[k][0] as string;
      if (seenImgNames.has(imgName)) continue;
      seenImgNames.add(imgName);

      try {
        // g_ prefix = global/common object, lives in page.commonObjs
        const store = imgName.startsWith("g_") ? page.commonObjs : page.objs;
        const imgObj: any = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout")), 5000);
          store.get(imgName, (obj: any) => { clearTimeout(timer); resolve(obj); });
        });
        if (!imgObj?.data || !imgObj.width || !imgObj.height) {
          console.log(`[pdf]   image "${imgName}" — no data/dims, skipped`);
          continue;
        }
        const pixels = imgObj.width * imgObj.height;
        if (pixels < MIN_IMG_PIXELS) {
          console.log(`[pdf]   image "${imgName}" — ${imgObj.width}x${imgObj.height} (${pixels}px) too small, skipped`);
          continue;
        }

        const bpp = imgObj.data.length / (imgObj.width * imgObj.height);
        console.log(`[pdf]   image "${imgName}" — ${imgObj.width}x${imgObj.height}, kind=${imgObj.kind}, dataLen=${imgObj.data.length}, bpp=${bpp}`);
        // Determine format from actual data size, not kind (kind can be unreliable)
        const isRGBA = bpp >= 4;
        const dataUri = isRGBA
          ? rgbaToPngDataUri(imgObj.data, imgObj.width, imgObj.height)
          : rgbToPngDataUri(imgObj.data, imgObj.width, imgObj.height);
        console.log(`[pdf]   image "${imgName}" — converted to PNG, dataUri length: ${dataUri.length}`);
        images.push({ dataUri, width: imgObj.width, height: imgObj.height });
      } catch (err: any) {
        console.warn(`[pdf]   image "${imgName}" — error: ${err.message}`);
      }
    }

    console.log(`[pdf] page ${i} — image ops: ${imgOpsCount}, unique: ${seenImgNames.size}, extracted: ${images.length}`);
    pages.push({ pageNum: i, text, images });
    page.cleanup();
  }

  console.log("[pdf] extraction complete, pages:", pages.length,
    "total images:", pages.reduce((s, p) => s + p.images.length, 0));
  return pages;
}

export function registerIoIpc(): void {
  // Export
  ipcMain.handle("export:markdown", async (_e, token: string) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");
    const { sections, export_ } = await getProjectServices(token);
    const allSections = await sections.listAll();
    await export_.exportToMarkdown(allSections, project.path);
  });

  ipcMain.handle("export:markdown-to", async (_e, token: string) => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths.length) return false;
    const { sections, export_ } = await getProjectServices(token);
    const allSections = await sections.listAll();
    await export_.writeToDir(allSections, result.filePaths[0]);
    return true;
  });

  // Import markdown
  ipcMain.handle("import:markdown", async (_e, token: string, folderId: string) => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "Import Markdown",
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths.length) return [];
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    const fileIds: string[] = [];
    for (const filePath of result.filePaths) {
      const content = readFileSync(filePath, "utf-8");
      const fileName = basename(filePath, extname(filePath));
      const fileId = await import_.importMarkdown(folderId, fileName, content);
      fileIds.push(fileId);
    }
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after markdown import:", err));
    return fileIds;
  });

  // Image picker
  ipcMain.handle("dialog:pickImage", async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "Выберите изображение",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const ext = extname(filePath).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const base64 = readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${base64}`;
  });

  // Import PDF
  ipcMain.handle("import:pdf", async (_e, token: string, folderId: string) => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "Import PDF",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    console.log("[pdf] importing file:", filePath);
    const buffer = readFileSync(filePath);
    console.log("[pdf] file read, size:", buffer.length);
    const pages = await extractPdfContent(buffer);
    const hasContent = pages.some(p => p.text.trim() || p.images.length > 0);
    console.log("[pdf] hasContent:", hasContent);
    if (!hasContent) {
      throw new Error("PDF не содержит извлекаемого контента (ни текста, ни изображений).");
    }
    const fileName = basename(filePath, extname(filePath));
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    console.log("[pdf] calling importPdfContent...");
    const fileId = await import_.importPdfContent(folderId, fileName, pages);
    console.log("[pdf] import done, fileId:", fileId);
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after pdf import:", err));
    return fileId;
  });

  // Import markdown from file paths (drag-and-drop)
  ipcMain.handle("import:markdown-files", async (_e, token: string, folderId: string, filePaths: string[]) => {
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    const fileIds: string[] = [];
    for (const filePath of filePaths) {
      const content = readFileSync(filePath, "utf-8");
      const fileName = basename(filePath, extname(filePath));
      const fileId = await import_.importMarkdown(folderId, fileName, content);
      fileIds.push(fileId);
    }
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after markdown drop:", err));
    return fileIds;
  });

  // Import PDF from file path (drag-and-drop)
  ipcMain.handle("import:pdf-file", async (_e, token: string, folderId: string, filePath: string) => {
    const buffer = readFileSync(filePath);
    const pages = await extractPdfContent(buffer);
    const hasContent = pages.some(p => p.text.trim() || p.images.length > 0);
    if (!hasContent) {
      throw new Error("PDF не содержит извлекаемого контента (ни текста, ни изображений).");
    }
    const fileName = basename(filePath, extname(filePath));
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    const fileId = await import_.importPdfContent(folderId, fileName, pages);
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after pdf drop:", err));
    return fileId;
  });
}
