import type { IdeaData, ProseMirrorNode } from "../types.js";
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
