import type { SectionsService } from "./sections.service.js";
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

  async importPdfContent(
    folderId: string,
    fileName: string,
    pages: Array<{ pageNum: number; text: string; images: Array<{ dataUri: string; width: number; height: number }> }>,
  ): Promise<string> {
    const file = await this.sections.create({
      parentId: folderId,
      title: fileName,
      type: "file",
    });

    for (const page of pages) {
      const hasText = page.text.trim().length > 0;
      const hasImages = page.images.length > 0;
      if (!hasText && !hasImages) continue;

      const parts: string[] = [];
      if (hasText) parts.push(page.text);
      for (const img of page.images) {
        parts.push(`![](${img.dataUri})`);
      }

      await this.sections.create({
        parentId: file.id,
        title: `Страница ${page.pageNum}`,
        content: parts.join("\n\n"),
        type: "section",
      });
    }

    return file.id;
  }
}
