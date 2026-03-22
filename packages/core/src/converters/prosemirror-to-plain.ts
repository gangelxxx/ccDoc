import type { ProseMirrorNode } from "../types.js";

export function prosemirrorToPlain(doc: ProseMirrorNode): string {
  if (doc.type !== "doc" || !doc.content) return "";
  return doc.content.map(extractText).filter(Boolean).join("\n\n");
}

function extractText(node: ProseMirrorNode): string {
  switch (node.type) {
    case "heading":
    case "paragraph":
      return getInlineText(node.content);
    case "bulletList":
    case "orderedList":
    case "taskList":
      return extractListText(node);
    case "codeBlock":
      return getInlineText(node.content);
    case "blockquote":
      return node.content ? node.content.map(extractText).filter(Boolean).join("\n") : "";
    case "callout":
      return node.content ? node.content.map(extractText).filter(Boolean).join("\n") : "";
    case "table":
      return extractTableText(node);
    case "excalidraw": {
      const name = node.attrs?.name as string;
      return name ? `[schema: ${name}]` : "";
    }
    case "mermaid":
      return "";
    case "image":
      return (node.attrs?.alt as string) || "";
    default:
      if (node.content) {
        return node.content.map(extractText).filter(Boolean).join("\n");
      }
      return node.text || "";
  }
}

function getInlineText(content?: ProseMirrorNode[]): string {
  if (!content) return "";
  return content.map((n) => n.text || "").join("");
}

function extractListText(node: ProseMirrorNode): string {
  if (!node.content) return "";
  return node.content
    .map((item) => {
      if (!item.content) return "";
      return item.content.map(extractText).filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

function extractTableText(node: ProseMirrorNode): string {
  if (!node.content) return "";
  return node.content
    .map((row) => {
      if (!row.content) return "";
      return row.content
        .map((cell) => {
          if (!cell.content) return "";
          return cell.content.map(extractText).filter(Boolean).join(" ");
        })
        .join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}
