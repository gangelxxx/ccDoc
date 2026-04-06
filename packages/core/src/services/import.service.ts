import type { SectionsService } from "./sections.service.js";
import type { PdfOutlineEntry } from "../types.js";
import { splitMarkdownByHeadings } from "../converters/markdown-splitter.js";

export class ImportService {
  constructor(private sections: SectionsService) {}

  async importMarkdown(folderId: string, fileName: string, markdown: string): Promise<string> {
    const { fileContent, sections } = splitMarkdownByHeadings(markdown);

    console.log(`[import] "${fileName}" — splitLevel picked, fileContent: ${fileContent.length} chars, sections: ${sections.length}`);
    for (const s of sections) {
      console.log(`[import]   § "${s.title}" — ${s.content.length} chars, children: ${s.children.length}`);
    }

    // Check if a file with the same title already exists in the target folder
    const existingFile = await this.sections.findChildByTitle(folderId, fileName, "file");

    let file: { id: string };
    if (existingFile) {
      console.log(`[import] found existing file "${fileName}" (${existingFile.id}), updating`);
      // Update file content
      if (fileContent) {
        await this.sections.update(existingFile.id, fileName, fileContent);
      }
      // Remove old children and recreate
      await this.sections.deleteChildren(existingFile.id);
      file = existingFile;
    } else {
      file = await this.sections.create({
        parentId: folderId,
        title: fileName,
        content: fileContent || undefined,
        type: "file",
      });
    }

    for (const s of sections) {
      const sec = await this.sections.create({
        parentId: file.id,
        title: s.title,
        content: s.content || undefined,
        type: "section",
      });
      for (const child of s.children) {
        await this.sections.create({
          parentId: sec.id,
          title: child.title,
          content: child.content || undefined,
          type: "section",
        });
      }
    }

    return file.id;
  }

  /** Import markdown into an existing file, splitting by headings into sections. */
  async importMarkdownIntoFile(fileId: string, markdown: string): Promise<void> {
    const { fileContent, sections } = splitMarkdownByHeadings(markdown);

    console.log(`[import] into file ${fileId} — fileContent: ${fileContent.length} chars, sections: ${sections.length}`);

    // If there's preamble content (before first heading), create a section for it
    if (fileContent.trim()) {
      await this.sections.create({
        parentId: fileId,
        title: "Untitled",
        content: fileContent,
        type: "section",
      });
    }

    for (const s of sections) {
      const sec = await this.sections.create({
        parentId: fileId,
        title: s.title,
        content: s.content || undefined,
        type: "section",
      });
      for (const child of s.children) {
        await this.sections.create({
          parentId: sec.id,
          title: child.title,
          content: child.content || undefined,
          type: "section",
        });
      }
    }
  }

  async importPdfContent(
    folderId: string,
    fileName: string,
    pages: Array<{ pageNum: number; text: string; images: Array<{ dataUri: string; width: number; height: number }> }>,
    outline?: PdfOutlineEntry[],
  ): Promise<string> {
    const file = await this.sections.create({
      parentId: folderId,
      title: fileName,
      type: "file",
    });

    // Use outline-based import if outline is available and non-empty
    if (outline && outline.length > 0) {
      await this.importPdfWithOutline(file.id, fileName, pages, outline);
      return file.id;
    }

    // Fallback: flat batch-based import
    await this.importPdfFlatBatches(file.id, pages);
    return file.id;
  }

  /** Build content string from pages in a given range (1-based, inclusive). */
  private buildPdfPageContent(
    pages: Array<{ pageNum: number; text: string; images: Array<{ dataUri: string; width: number; height: number }> }>,
    startPage: number,
    endPage: number,
  ): string {
    const parts: string[] = [];
    for (const page of pages) {
      if (page.pageNum < startPage || page.pageNum > endPage) continue;
      if (page.text.trim()) parts.push(page.text);
      for (const img of page.images) {
        parts.push(`![](${img.dataUri})`);
      }
    }
    return parts.join("\n\n");
  }

  /** Import PDF using outline hierarchy to create nested sections. */
  private async importPdfWithOutline(
    fileId: string,
    fileName: string,
    pages: Array<{ pageNum: number; text: string; images: Array<{ dataUri: string; width: number; height: number }> }>,
    outline: PdfOutlineEntry[],
  ): Promise<void> {
    const lastPageNum = pages.length > 0 ? pages[pages.length - 1].pageNum : 0;

    // Pages before the first outline entry become the file's own content
    if (outline[0].pageNum > 1) {
      const preContent = this.buildPdfPageContent(pages, 1, outline[0].pageNum - 1);
      if (preContent.trim()) {
        await this.sections.update(fileId, fileName, preContent);
      }
    }

    // parentStack[level] = section id at that nesting depth
    // parentStack[0] = fileId (level-0 entries are children of the file)
    const parentStack: string[] = [fileId];

    for (let i = 0; i < outline.length; i++) {
      const entry = outline[i];
      const nextEntry = outline[i + 1];
      const endPage = nextEntry ? nextEntry.pageNum - 1 : lastPageNum;

      // Determine "own" pages: pages that belong directly to this entry,
      // not to any child entry at a deeper level.
      // Find the first subsequent entry that is deeper than current (a child).
      let ownEndPage = endPage;
      for (let j = i + 1; j < outline.length; j++) {
        if (outline[j].level <= entry.level) break; // sibling or parent — stop
        // Found a child entry — own content ends before it
        ownEndPage = outline[j].pageNum - 1;
        break;
      }

      // Ensure ownEndPage is at least startPage (for entries on the same page as their first child)
      if (ownEndPage < entry.pageNum) ownEndPage = entry.pageNum;

      const content = this.buildPdfPageContent(pages, entry.pageNum, ownEndPage);

      // Navigate parent stack to the correct level
      // Trim the stack so parentStack.length === entry.level + 1
      while (parentStack.length > entry.level + 1) {
        parentStack.pop();
      }

      // If the stack is shorter than expected (e.g., a level-2 entry without
      // a preceding level-1), the parent defaults to the deepest available.
      const parentId = parentStack[parentStack.length - 1];

      try {
        const section = await this.sections.create({
          parentId,
          title: entry.title,
          content: content.trim() ? content : undefined,
          type: "section",
        });

        // Push this section as potential parent for deeper levels
        parentStack.push(section.id);

        if (!content.trim()) {
          console.warn(`[import] outline[${i}] "${entry.title}" (L${entry.level} p${entry.pageNum}-${ownEndPage}) — no content`);
        } else {
          console.log(`[import] outline[${i}] "${entry.title}" — ${content.length} chars → section ${section.id}`);
        }

        // Verify the section was stored with content
        const stored = await this.sections.getById(section.id);
        if (stored && stored.content === '{"type":"doc","content":[{"type":"paragraph"}]}') {
          console.error(`[import] outline[${i}] "${entry.title}" — STORED EMPTY despite ${content.length} chars input!`);
        }
      } catch (err: any) {
        console.error(`[import] outline[${i}] "${entry.title}" FAILED:`, err.message);
        // Push a placeholder so parentStack stays aligned
        parentStack.push(parentId);
      }
    }

    console.log(`[import] PDF outline import: ${outline.length} sections created from outline`);
  }

  /** Fallback: flat batch-based import (original logic). */
  private async importPdfFlatBatches(
    fileId: string,
    pages: Array<{ pageNum: number; text: string; images: Array<{ dataUri: string; width: number; height: number }> }>,
  ): Promise<void> {
    // Filter pages with content
    const contentPages = pages.filter(p => p.text.trim().length > 0 || p.images.length > 0);

    // Batch pages for large PDFs to avoid creating too many sections
    const BATCH_SIZE = 10;
    const useBatching = contentPages.length > BATCH_SIZE;

    if (useBatching) {
      for (let i = 0; i < contentPages.length; i += BATCH_SIZE) {
        const batch = contentPages.slice(i, i + BATCH_SIZE);
        const first = batch[0].pageNum;
        const last = batch[batch.length - 1].pageNum;
        const title = first === last ? `Page ${first}` : `Pages ${first}–${last}`;

        const batchParts: string[] = [];
        for (const page of batch) {
          batchParts.push(`## Page ${page.pageNum}\n`);
          if (page.text.trim()) batchParts.push(page.text);
          for (const img of page.images) {
            batchParts.push(`![](${img.dataUri})`);
          }
        }

        await this.sections.create({
          parentId: fileId,
          title,
          content: batchParts.join("\n\n"),
          type: "section",
        });
      }
    } else {
      for (const page of contentPages) {
        const parts: string[] = [];
        if (page.text.trim()) parts.push(page.text);
        for (const img of page.images) {
          parts.push(`![](${img.dataUri})`);
        }

        await this.sections.create({
          parentId: fileId,
          title: `Page ${page.pageNum}`,
          content: parts.join("\n\n"),
          type: "section",
        });
      }
    }
  }
}
