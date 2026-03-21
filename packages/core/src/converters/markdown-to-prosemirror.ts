import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { ProseMirrorNode } from "../types.js";

// Using inline types to avoid @types/mdast dependency issues
type MdNode = { type: string; children?: MdNode[]; [key: string]: unknown };

export function markdownToProsemirror(markdown: string): ProseMirrorNode {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const content = (tree.children as MdNode[]).flatMap(convertMdastNode).filter(Boolean) as ProseMirrorNode[];

  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

function convertMdastNode(node: MdNode): ProseMirrorNode | null {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.depth as number },
        content: convertInlineNodes(node.children || []),
      };
    case "paragraph": {
      const children = node.children || [];
      // Paragraph containing only image(s) → emit block-level image nodes
      // (ProseMirror images are block nodes, can't be inline inside a paragraph)
      if (children.length === 1 && children[0].type === "image") {
        const img = children[0];
        return {
          type: "image",
          attrs: { src: img.url as string, alt: (img.alt as string) || "" },
        };
      }
      return {
        type: "paragraph",
        content: convertInlineNodes(children),
      };
    }
    case "list": {
      const items = node.children || [];
      if (items.some((item: MdNode) => item.checked !== null && item.checked !== undefined)) {
        return {
          type: "taskList",
          content: items.map((item: MdNode) => ({
            type: "taskItem",
            attrs: { checked: (item.checked as boolean) ?? false },
            content: (item.children || []).flatMap(convertMdastNode).filter(Boolean) as ProseMirrorNode[],
          })),
        };
      }
      const listType = node.ordered ? "orderedList" : "bulletList";
      return {
        type: listType,
        content: items.map((item: MdNode) => ({
          type: "listItem",
          content: (item.children || []).flatMap(convertMdastNode).filter(Boolean) as ProseMirrorNode[],
        })),
      };
    }
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: (node.lang as string) || null },
        content: node.value ? [{ type: "text", text: node.value as string }] : [],
      };
    case "blockquote":
      return {
        type: "blockquote",
        content: (node.children || []).flatMap(convertMdastNode).filter(Boolean) as ProseMirrorNode[],
      };
    case "table":
      return convertTable(node);
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "image":
      return {
        type: "image",
        attrs: { src: node.url as string, alt: (node.alt as string) || "" },
      };
    case "html": {
      const text = (node.value as string) || "";
      return text.trim()
        ? { type: "paragraph", content: [{ type: "text", text }] }
        : null;
    }
    case "yaml":
      return {
        type: "codeBlock",
        attrs: { language: "yaml" },
        content: node.value ? [{ type: "text", text: node.value as string }] : [],
      };
    default: {
      // Try to preserve unknown nodes as text or recurse into children
      if (node.value) {
        return { type: "paragraph", content: [{ type: "text", text: node.value as string }] };
      }
      if (node.children && node.children.length > 0) {
        const children = node.children.flatMap(convertMdastNode).filter(Boolean) as ProseMirrorNode[];
        return children.length === 1 ? children[0] : children.length > 0
          ? { type: "paragraph", content: children.flatMap(c => c.content || [{ type: "text", text: " " }]) }
          : null;
      }
      return null;
    }
  }
}

function convertInlineNodes(nodes: MdNode[]): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  for (const node of nodes) {
    const converted = convertInline(node);
    if (converted) result.push(...converted);
  }
  return result;
}

function convertInline(node: MdNode): ProseMirrorNode[] | null {
  switch (node.type) {
    case "text":
      return node.value ? [{ type: "text", text: node.value as string }] : null;
    case "strong":
      return applyMarkToChildren(node.children || [], { type: "bold" });
    case "emphasis":
      return applyMarkToChildren(node.children || [], { type: "italic" });
    case "delete":
      return applyMarkToChildren(node.children || [], { type: "strike" });
    case "inlineCode":
      return [{ type: "text", text: node.value as string, marks: [{ type: "code" }] }];
    case "link":
      return applyMarkToChildren(node.children || [], { type: "link", attrs: { href: node.url as string } });
    case "image":
      return [{ type: "image", attrs: { src: node.url as string, alt: (node.alt as string) || "" } }];
    case "break":
      return [{ type: "hardBreak" }];
    case "html":
      return node.value ? [{ type: "text", text: node.value as string }] : null;
    default:
      // Preserve unknown inline nodes as text if possible
      if (node.value) return [{ type: "text", text: node.value as string }];
      if (node.children) return convertInlineNodes(node.children);
      return null;
  }
}

function applyMarkToChildren(
  children: MdNode[],
  mark: { type: string; attrs?: Record<string, unknown> }
): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  for (const child of children) {
    const converted = convertInline(child);
    if (converted) {
      for (const node of converted) {
        node.marks = [...(node.marks || []), mark];
        result.push(node);
      }
    }
  }
  return result;
}

function convertTable(node: MdNode): ProseMirrorNode {
  const rows = node.children || [];
  return {
    type: "table",
    content: rows.map((row: MdNode, rowIdx: number) => ({
      type: "tableRow",
      content: (row.children || []).map((cell: MdNode) => ({
        type: rowIdx === 0 ? "tableHeader" : "tableCell",
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: [
          {
            type: "paragraph",
            content: convertInlineNodes(cell.children || []),
          },
        ],
      })),
    })),
  };
}
