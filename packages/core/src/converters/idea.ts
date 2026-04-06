import type { IdeaData, IdeaMessage, ProseMirrorNode } from "../types.js";
import { prosemirrorToPlain } from "./prosemirror-to-plain.js";

/**
 * Extracts text from idea content (chat messages) for the search index.
 * Concatenates text from all messages.
 * @param content JSON string in IdeaData format or a legacy ProseMirror document
 */
export function ideaToPlain(content: string): string {
  try {
    const parsed = JSON.parse(content);
    // Legacy: ideas in the old ProseMirror format
    if (parsed.type === "doc") {
      return prosemirrorToPlain(parsed as ProseMirrorNode);
    }
    const data = parsed as IdeaData;
    if (!data.messages || !Array.isArray(data.messages)) return "";
    return data.messages
      .map((m) => m.text)
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Exports ideas with group and title support.
 * If groups exist, outputs by group; otherwise outputs a flat list.
 */
export function ideaToGroupedPlain(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === "doc") {
      return prosemirrorToPlain(parsed as ProseMirrorNode);
    }
    const data = parsed as IdeaData;
    if (!data.messages || !Array.isArray(data.messages)) return "";

    const msgs = data.messages as IdeaMessage[];
    const hasGroups = msgs.some((m) => m.group);

    if (!hasGroups) {
      return msgs
        .map((m) => {
          const prefix = m.title ? `### ${m.title}\n` : "";
          return `${prefix}${m.text}`;
        })
        .filter(Boolean)
        .join("\n\n");
    }

    // Group messages
    const groups = new Map<string, IdeaMessage[]>();
    const ungrouped: IdeaMessage[] = [];
    for (const m of msgs) {
      if (m.group) {
        const arr = groups.get(m.group) || [];
        arr.push(m);
        groups.set(m.group, arr);
      } else {
        ungrouped.push(m);
      }
    }

    const parts: string[] = [];
    for (const [name, items] of groups) {
      parts.push(`## ${name}`);
      for (const m of items) {
        const prefix = m.title ? `### ${m.title}\n` : "";
        parts.push(`${prefix}${m.text}`);
      }
    }
    if (ungrouped.length > 0) {
      for (const m of ungrouped) {
        const prefix = m.title ? `### ${m.title}\n` : "";
        parts.push(`${prefix}${m.text}`);
      }
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}
