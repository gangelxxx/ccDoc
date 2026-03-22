import type { ProseMirrorNode, ProseMirrorMark } from "../types.js";

export function prosemirrorToMarkdown(doc: ProseMirrorNode): string {
  if (doc.type !== "doc" || !doc.content) return "";
  return doc.content.map((node) => renderNode(node, 0)).join("\n\n");
}

function renderNode(node: ProseMirrorNode, depth: number): string {
  switch (node.type) {
    case "heading":
      return renderHeading(node);
    case "paragraph":
      return renderInlineContent(node.content);
    case "bulletList":
      return renderList(node, "bullet", depth);
    case "orderedList":
      return renderList(node, "ordered", depth);
    case "taskList":
      return renderTaskList(node, depth);
    case "codeBlock":
      return renderCodeBlock(node);
    case "blockquote":
      return renderBlockquote(node);
    case "table":
      return renderTable(node);
    case "excalidraw":
      return `[whiteboard: ${(node.attrs?.name as string) || "Untitled"}]`;
    case "mermaid":
      return `\`\`\`mermaid\n${(node.attrs?.code as string) || ""}\n\`\`\``;
    case "callout":
      return renderCallout(node);
    case "image":
      return `![${(node.attrs?.alt as string) || ""}](${(node.attrs?.src as string) || ""})`;
    case "horizontalRule":
      return "---";
    default:
      if (node.content) {
        return node.content.map((n) => renderNode(n, depth)).join("\n\n");
      }
      return node.text || "";
  }
}

function renderHeading(node: ProseMirrorNode): string {
  const level = (node.attrs?.level as number) || 1;
  const text = renderInlineContent(node.content);
  return `${"#".repeat(level)} ${text}`;
}

function renderInlineContent(content?: ProseMirrorNode[]): string {
  if (!content) return "";
  return content.map(renderInline).join("");
}

function renderInline(node: ProseMirrorNode): string {
  if (node.type === "text") {
    let text = node.text || "";
    if (node.marks) {
      for (const mark of node.marks) {
        text = applyMark(text, mark);
      }
    }
    return text;
  }
  if (node.type === "hardBreak") return "\n";
  return node.text || "";
}

function applyMark(text: string, mark: ProseMirrorMark): string {
  switch (mark.type) {
    case "bold":
    case "strong":
      return `**${text}**`;
    case "italic":
    case "em":
      return `*${text}*`;
    case "code":
      return `\`${text}\``;
    case "strike":
      return `~~${text}~~`;
    case "link":
      return `[${text}](${(mark.attrs?.href as string) || ""})`;
    case "textStyle":
      if (mark.attrs?.color) {
        return `<span style="color:${mark.attrs.color}">${text}</span>`;
      }
      return text;
    default:
      return text;
  }
}

function renderList(node: ProseMirrorNode, type: "bullet" | "ordered", depth: number): string {
  if (!node.content) return "";
  const indent = "  ".repeat(depth);
  return node.content
    .map((item, i) => {
      const prefix = type === "bullet" ? "-" : `${i + 1}.`;
      const content = renderListItem(item, depth);
      return `${indent}${prefix} ${content}`;
    })
    .join("\n");
}

function renderListItem(node: ProseMirrorNode, depth: number): string {
  if (!node.content) return "";
  return node.content
    .map((child) => {
      if (child.type === "paragraph") return renderInlineContent(child.content);
      if (child.type === "bulletList" || child.type === "orderedList") {
        return "\n" + renderList(child, child.type === "bulletList" ? "bullet" : "ordered", depth + 1);
      }
      return renderNode(child, depth + 1);
    })
    .join("\n");
}

function renderTaskList(node: ProseMirrorNode, depth: number): string {
  if (!node.content) return "";
  const indent = "  ".repeat(depth);
  return node.content
    .map((item) => {
      const checked = item.attrs?.checked ? "x" : " ";
      const text = item.content
        ? item.content.map((child) => {
            if (child.type === "paragraph") return renderInlineContent(child.content);
            return renderNode(child, depth + 1);
          }).join("\n")
        : "";
      return `${indent}- [${checked}] ${text}`;
    })
    .join("\n");
}

function renderCodeBlock(node: ProseMirrorNode): string {
  const lang = (node.attrs?.language as string) || "";
  const code = renderInlineContent(node.content);
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

function renderBlockquote(node: ProseMirrorNode): string {
  if (!node.content) return "> ";
  return node.content
    .map((child) => renderNode(child, 0))
    .join("\n\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderTableCell(cell: ProseMirrorNode): string {
  if (!cell.content) return "";
  return cell.content
    .map((child) => {
      if (child.type === "paragraph") return renderInlineContent(child.content);
      return renderNode(child, 0);
    })
    .join(" ")
    .replace(/\|/g, "\\|");
}

function renderTable(node: ProseMirrorNode): string {
  if (!node.content) return "";
  const rows = node.content.map((row) => {
    if (!row.content) return [];
    return row.content.map((cell) => renderTableCell(cell));
  });
  if (rows.length === 0) return "";

  const header = `| ${rows[0].join(" | ")} |`;
  const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(1)
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  return [header, separator, body].filter(Boolean).join("\n");
}

function renderCallout(node: ProseMirrorNode): string {
  const type = ((node.attrs?.type as string) || "info").toUpperCase();
  const content = node.content
    ? node.content.map((n) => renderNode(n, 0)).join("\n\n")
    : "";
  const lines = `**${type}:** ${content}`.split("\n");
  return lines.map((line) => `> ${line}`).join("\n");
}
