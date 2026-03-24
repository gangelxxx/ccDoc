/**
 * Splits markdown text by ## and ### headings into a nested section tree.
 * Used when creating file-type sections to break content into child sections.
 */

import type { SplitSection } from "./types.js";

export function splitMarkdownIntoSections(markdown: string): SplitSection[] {
  const lines = markdown.split("\n");
  const isSubstantive = (text: string) => text.replace(/^[-\s*_]+$/gm, "").trim().length > 0;
  const stripNumber = (s: string) => s.replace(/^\d+[\.\)]\s*/, "").trim();

  const sections: SplitSection[] = [];
  let curH2: SplitSection | null = null;
  let curH3: { title: string; lines: string[] } | null = null;
  let preLines: string[] = [];

  const flushH3 = () => {
    if (curH3 && curH2) {
      const content = curH3.lines.join("\n").trim();
      if (isSubstantive(content)) {
        curH2.children.push({ title: curH3.title, content, children: [] });
      }
      curH3 = null;
    }
  };

  const flushH2 = () => {
    flushH3();
    if (curH2) {
      if (isSubstantive(curH2.content) || curH2.children.length > 0) {
        sections.push(curH2);
      }
      curH2 = null;
    }
  };

  let preambleLines: string[] = [];
  let seenH2 = false;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);

    if (h2 && !h3) {
      // Flush preamble as first section if we haven't seen a ## yet
      if (!seenH2 && preambleLines.length > 0) {
        const preambleContent = preambleLines.join("\n").trim();
        if (isSubstantive(preambleContent)) {
          sections.push({ title: "Вступление", content: preambleContent, children: [] });
        }
        preambleLines = [];
      }
      seenH2 = true;
      flushH2();
      curH2 = { title: stripNumber(h2[1]), content: "", children: [] };
    } else if (h3 && curH2) {
      if (curH3) {
        flushH3();
      } else {
        curH2.content = preLines.join("\n").trim();
        preLines = [];
      }
      curH3 = { title: stripNumber(h3[1]), lines: [] };
    } else {
      // Skip top-level # heading (file title duplicate)
      if (!curH2 && line.match(/^#\s+/)) continue;

      if (curH3) {
        curH3.lines.push(line);
      } else if (curH2) {
        preLines.push(line);
      } else {
        // Pre-H2 content (introduction before first ## heading)
        preambleLines.push(line);
      }
    }
  }
  // Flush remaining
  if (curH2 && !curH3) {
    curH2.content = preLines.join("\n").trim();
  }
  flushH2();

  return sections.length > 0 ? sections : [{ title: "Содержание", content: markdown, children: [] }];
}
