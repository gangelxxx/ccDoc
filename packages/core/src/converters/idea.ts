import type { IdeaData, IdeaMessage, ProseMirrorNode } from "../types.js";
import { prosemirrorToPlain } from "./prosemirror-to-plain.js";

/**
 * Извлекает текст из содержимого идеи (чат-сообщения) для поискового индекса.
 * Конкатенирует текст всех сообщений.
 * @param content JSON-строка формата IdeaData или legacy ProseMirror document
 */
export function ideaToPlain(content: string): string {
  try {
    const parsed = JSON.parse(content);
    // Legacy: идеи в старом ProseMirror-формате
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
 * Экспортирует идеи с учётом групп и заголовков.
 * Если группы есть — выводит по группам, если нет — плоский список.
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
