import type { ProseMirrorNode, StructuredBlock, StructuredOutput } from "../types.js";

export function prosemirrorToStructured(doc: ProseMirrorNode, title: string): StructuredOutput {
  const blocks: StructuredBlock[] = [];
  if (doc.type === "doc" && doc.content) {
    for (const node of doc.content) {
      const block = convertBlock(node);
      if (block) blocks.push(block);
    }
  }
  return { title, blocks };
}

function convertBlock(node: ProseMirrorNode): StructuredBlock | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        level: (node.attrs?.level as number) || 1,
        text: getInlineText(node.content),
      };
    case "paragraph":
      return { type: "text", text: getInlineText(node.content) };
    case "bulletList":
    case "orderedList":
      return {
        type: "list",
        items: (node.content || []).map((item) => ({
          type: "list_item",
          text: item.content ? item.content.map((c) => getInlineText(c.content)).join(" ") : "",
        })),
      };
    case "taskList":
      return {
        type: "task_list",
        items: (node.content || []).map((item) => ({
          type: "task",
          text: getInlineText(item.content?.[0]?.content),
          checked: (item.attrs?.checked as boolean) || false,
        })),
      };
    case "codeBlock":
      return {
        type: "code",
        language: (node.attrs?.language as string) || undefined,
        text: getInlineText(node.content),
      };
    case "blockquote":
      return {
        type: "blockquote",
        text: node.content ? node.content.map((c) => getInlineText(c.content)).join("\n") : "",
      };
    case "excalidraw":
      return {
        type: "whiteboard",
        name: (node.attrs?.name as string) || "Untitled",
      };
    case "mermaid":
      return {
        type: "diagram",
        text: (node.attrs?.code as string) || "",
      };
    case "callout":
      return {
        type: "callout",
        text: node.content ? node.content.map((c) => getInlineText(c.content)).join("\n") : "",
      };
    case "table":
      return {
        type: "table",
        text: extractTableText(node),
      };
    case "image":
      return {
        type: "image",
        text: (node.attrs?.alt as string) || "",
      };
    default:
      return null;
  }
}

function getInlineText(content?: ProseMirrorNode[]): string {
  if (!content) return "";
  return content.map((n) => n.text || "").join("");
}

function extractTableText(node: ProseMirrorNode): string {
  if (!node.content) return "";
  return node.content
    .map((row) =>
      (row.content || []).map((cell) => {
        if (!cell.content) return "";
        return cell.content.map((child) => getInlineText(child.content)).filter(Boolean).join(" ");
      }).join(" | ")
    )
    .join("\n");
}
