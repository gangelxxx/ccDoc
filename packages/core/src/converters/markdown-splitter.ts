import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

type MdNode = { type: string; depth?: number; children?: MdNode[]; position?: { start: { offset: number }; end: { offset: number } }; [key: string]: unknown };

export interface SplitSection {
  title: string;
  content: string;
  children: SplitSection[];
}

export interface SplitResult {
  fileContent: string;
  sections: SplitSection[];
}

function extractHeadingText(node: MdNode): string {
  if (!node.children) return "";
  return node.children
    .map((c) => {
      if (c.type === "text" || c.type === "inlineCode") return c.value as string;
      if (c.children) return extractHeadingText(c);
      return "";
    })
    .join("");
}

function splitContentBySubheadings(content: string, subLevel: number): { preamble: string; children: SplitSection[] } {
  const tree = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const nodes = tree.children as MdNode[];
  const subHeadings: Array<{ title: string; offset: number }> = [];
  for (const node of nodes) {
    if (node.type === "heading" && node.depth === subLevel && node.position) {
      subHeadings.push({
        title: extractHeadingText(node),
        offset: node.position.start.offset,
      });
    }
  }

  if (subHeadings.length === 0) {
    return { preamble: content, children: [] };
  }

  const preamble = content.slice(0, subHeadings[0].offset).trim();
  const children: SplitSection[] = [];

  for (let i = 0; i < subHeadings.length; i++) {
    const start = subHeadings[i].offset;
    const end = i + 1 < subHeadings.length ? subHeadings[i + 1].offset : content.length;
    const chunk = content.slice(start, end);
    const newlineIdx = chunk.indexOf("\n");
    const body = newlineIdx >= 0 ? chunk.slice(newlineIdx + 1).trim() : "";
    children.push({ title: subHeadings[i].title, content: body, children: [] });
  }

  return { preamble, children };
}

export function splitMarkdownByHeadings(markdown: string): SplitResult {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const children = tree.children as MdNode[];

  // Collect headings with positions
  const headings: Array<{ depth: number; title: string; offset: number }> = [];
  for (const node of children) {
    if (node.type === "heading" && node.depth !== undefined && node.position) {
      headings.push({
        depth: node.depth,
        title: extractHeadingText(node),
        offset: node.position.start.offset,
      });
    }
  }

  // No headings — return everything as file content
  if (headings.length === 0) {
    return { fileContent: markdown.trim(), sections: [] };
  }

  // Count headings by level, pick split level
  const counts = new Map<number, number>();
  for (const h of headings) {
    counts.set(h.depth, (counts.get(h.depth) || 0) + 1);
  }
  const levels = [...counts.keys()].sort((a, b) => a - b);
  let splitLevel = levels[0];
  if (counts.get(splitLevel) === 1 && levels.length > 1) {
    splitLevel = levels[1];
  }

  const subLevel = splitLevel + 1;
  const hasSubHeadings = headings.some((h) => h.depth === subLevel);

  // Filter to split-level headings
  const splitHeadings = headings.filter((h) => h.depth === splitLevel);

  // Slice original markdown by heading positions
  const fileContent = markdown.slice(0, splitHeadings[0].offset).trim();

  const sections: SplitSection[] = [];
  for (let i = 0; i < splitHeadings.length; i++) {
    const start = splitHeadings[i].offset;
    const end = i + 1 < splitHeadings.length ? splitHeadings[i + 1].offset : markdown.length;
    const chunk = markdown.slice(start, end);

    // Remove the heading line itself from content
    const newlineIdx = chunk.indexOf("\n");
    const rawContent = newlineIdx >= 0 ? chunk.slice(newlineIdx + 1).trim() : "";

    if (hasSubHeadings && rawContent) {
      const { preamble, children: subChildren } = splitContentBySubheadings(rawContent, subLevel);
      sections.push({ title: splitHeadings[i].title, content: preamble, children: subChildren });
    } else {
      sections.push({ title: splitHeadings[i].title, content: rawContent, children: [] });
    }
  }

  return { fileContent, sections };
}
