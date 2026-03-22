import type { ProseMirrorNode } from "../types.js";

export function extractTextForSearch(doc: ProseMirrorNode): string {
  const parts: string[] = [];
  extractFromNode(doc, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function extractFromNode(node: ProseMirrorNode, parts: string[]): void {
  if (node.text) {
    parts.push(node.text);
    return;
  }

  // Skip code blocks and mermaid diagrams for search
  if (node.type === "codeBlock" || node.type === "mermaid") return;

  // Drawing: only index the name
  if (node.type === "drawing") {
    const name = node.attrs?.name as string;
    if (name) parts.push(name);
    return;
  }

  if (node.content) {
    for (const child of node.content) {
      extractFromNode(child, parts);
    }
  }
}
