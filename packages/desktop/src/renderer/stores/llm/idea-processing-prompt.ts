/**
 * Prompt builder & response parser for LLM-based idea processing.
 *
 * Modes: title, polish, deduplicate, group, full.
 * Returns structured JSON that is validated before applying.
 */

import type { IdeaMessage, IdeaProcessingMode, IdeaProcessingResult } from "@ccdoc/core";

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildIdeaProcessingPrompt(
  messages: IdeaMessage[],
  mode: IdeaProcessingMode,
  language: "ru" | "en",
): string {
  const messagesJson = JSON.stringify(
    messages.map((m) => ({
      id: m.id,
      text: m.text,
      createdAt: m.createdAt,
      ...(m.completed ? { completed: true } : {}),
      ...(m.planId ? { planId: m.planId } : {}),
      ...(m.images?.length ? { hasImages: true } : {}),
      ...(m.title ? { title: m.title } : {}),
      ...(m.group ? { group: m.group } : {}),
    })),
    null,
    2,
  );

  const ru = language === "ru";

  const modeInstructions: Record<IdeaProcessingMode, string> = {
    title: ru
      ? `Сгенерируй краткий заголовок (title) для каждой идеи — одно предложение, отражающее суть.
Не меняй text, не удаляй и не объединяй сообщения. Только добавь поле "title" к каждому.`
      : `Generate a short title for each idea — one sentence capturing its essence.
Do not change text, do not remove or merge messages. Only add the "title" field to each.`,

    polish: ru
      ? `Улучши формулировки каждой идеи: сделай текст более структурированным, грамотным и читабельным.
Сохрани смысл. Исправь грамматику и опечатки. Не удаляй и не объединяй сообщения.
Обнови поле "text" каждого сообщения.`
      : `Polish the text of each idea: make it more structured, grammatically correct, and readable.
Preserve the meaning. Fix grammar and typos. Do not remove or merge messages.
Update the "text" field of each message.`,

    deduplicate: ru
      ? `Найди семантические дубликаты — идеи с одинаковым смыслом (не обязательно одинаковыми словами).
Для каждой группы дубликатов: оставь одну (лучшую формулировку), удали остальные.
В оставшейся идее добавь поле "originalIds" — массив ID удалённых дубликатов.
Заполни массив "removedDuplicates" в ответе с полями keptId, removedIds, reason.
ВАЖНО: Не удаляй идеи со статусом completed=true при дедупликации.`
      : `Find semantic duplicates — ideas with the same meaning (not necessarily the same words).
For each group of duplicates: keep one (best wording), remove the rest.
In the kept idea add "originalIds" field — array of IDs of removed duplicates.
Fill the "removedDuplicates" array in the response with keptId, removedIds, reason.
IMPORTANT: Do not remove ideas with completed=true during deduplication.`,

    group: ru
      ? `Группируй идеи по темам. Выдели 3–7 тематических групп.
Каждому сообщению назначь одну группу через поле "group" (название группы).
Заполни массив "groups" в ответе с полями name и messageIds.
Не меняй text, не удаляй и не объединяй сообщения.`
      : `Group ideas by topics. Identify 3–7 thematic groups.
Assign each message to one group via the "group" field (group name).
Fill the "groups" array in the response with name and messageIds.
Do not change text, do not remove or merge messages.`,

    full: ru
      ? `Выполни все операции последовательно:
1. Сгенерируй заголовки (title) для каждой идеи.
2. Улучши формулировки (text) — грамматика, структура, читабельность.
3. Удали семантические дубликаты (originalIds, removedDuplicates).
4. Сгруппируй оставшиеся идеи по темам (group, groups).
ВАЖНО: Не удаляй идеи со статусом completed=true при дедупликации.`
      : `Perform all operations sequentially:
1. Generate titles (title) for each idea.
2. Polish text — grammar, structure, readability.
3. Remove semantic duplicates (originalIds, removedDuplicates).
4. Group remaining ideas by topics (group, groups).
IMPORTANT: Do not remove ideas with completed=true during deduplication.`,
  };

  const baseRules = ru
    ? `ПРАВИЛА:
- Ответ СТРОГО в формате JSON (без markdown code-blocks, без пояснений — только JSON).
- Сохрани id, createdAt, planId, completed, images каждого сообщения без изменений.
- Поле "images" НЕ включено во входные данные, но существует у некоторых сообщений — НЕ добавляй и НЕ удаляй его.
- Для новых (объединённых) сообщений генерируй новый UUID v4. createdAt бери из самой ранней идеи в группе.
- Язык текста: сохраняй оригинальный язык каждой идеи (RU/EN).
- Поле "summary" — одно предложение, описывающее что было сделано.`
    : `RULES:
- Response STRICTLY in JSON format (no markdown code-blocks, no explanations — only JSON).
- Preserve id, createdAt, planId, completed, images of each message unchanged.
- The "images" field is NOT included in input but exists for some messages — do NOT add or remove it.
- For new (merged) messages generate a new UUID v4. Use createdAt from the earliest idea in the group.
- Text language: preserve the original language of each idea (RU/EN).
- "summary" field — one sentence describing what was done.`;

  const responseSchema = `{
  "messages": [
    {
      "id": "string (UUID)",
      "text": "string",
      "createdAt": number,
      "completed?": boolean,
      "planId?": "string",
      "title?": "string",
      "group?": "string",
      "originalIds?": ["string"]
    }
  ],
  "removedDuplicates": [
    { "keptId": "string", "removedIds": ["string"], "reason": "string" }
  ],
  "groups": [
    { "name": "string", "messageIds": ["string"] }
  ],
  "summary": "string"
}`;

  return `${ru ? "Ты — ассистент для обработки списка идей." : "You are an assistant for processing a list of ideas."}

${ru ? "ЗАДАНИЕ:" : "TASK:"}
${modeInstructions[mode]}

${baseRules}

${ru ? "ФОРМАТ ОТВЕТА (JSON):" : "RESPONSE FORMAT (JSON):"}
${responseSchema}

${ru ? "ВХОДНЫЕ ДАННЫЕ (идеи):" : "INPUT DATA (ideas):"}
${messagesJson}`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Extract JSON from LLM response (handles ```json ... ``` wrapping).
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Try to extract from code block first
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  // If starts with { — assume raw JSON
  if (trimmed.startsWith("{")) return trimmed;
  // Try to find first { ... last }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/**
 * Parse and validate LLM response into IdeaProcessingResult.
 * Throws on invalid JSON or missing required fields.
 */
export function parseProcessingResult(
  llmResponse: string,
  originalMessages: IdeaMessage[],
): IdeaProcessingResult {
  const json = extractJson(llmResponse);
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid JSON in LLM response: ${(e as Error).message}`);
  }

  // Validate structure
  if (!parsed.messages || !Array.isArray(parsed.messages)) {
    throw new Error("Missing or invalid 'messages' array in response");
  }
  if (parsed.messages.length === 0) {
    throw new Error("Empty 'messages' array in response");
  }

  // Build lookup for original messages to restore images
  const origMap = new Map(originalMessages.map((m) => [m.id, m]));

  // Validate and restore fields
  const messages: IdeaMessage[] = parsed.messages.map((m: any) => {
    if (!m.id || typeof m.text !== "string") {
      throw new Error(`Invalid message: missing id or text`);
    }
    const orig = origMap.get(m.id);
    const msg: IdeaMessage = {
      id: m.id,
      text: m.text,
      createdAt: typeof m.createdAt === "number" ? m.createdAt : (orig?.createdAt ?? Date.now()),
      ...(m.completed ? { completed: true } : (orig?.completed ? { completed: true } : {})),
      ...(m.planId ? { planId: m.planId } : (orig?.planId ? { planId: orig.planId } : {})),
      ...(orig?.editedAt ? { editedAt: orig.editedAt } : {}),
      // Restore images from original (LLM doesn't see them)
      ...(orig?.images?.length ? { images: orig.images } : {}),
      // New fields
      ...(m.title ? { title: m.title } : {}),
      ...(m.group ? { group: m.group } : {}),
      ...(m.originalIds?.length ? { originalIds: m.originalIds } : {}),
    };
    // For merged messages (originalIds), restore images from first original
    if (m.originalIds?.length && !orig) {
      for (const oid of m.originalIds) {
        const o = origMap.get(oid);
        if (o?.images?.length) {
          msg.images = o.images;
          break;
        }
      }
    }
    return msg;
  });

  // Validate completeness: all original IDs should appear either in messages or in removedDuplicates
  const resultIds = new Set(messages.map((m) => m.id));
  const removedIds = new Set<string>();
  const removedDuplicates = Array.isArray(parsed.removedDuplicates)
    ? parsed.removedDuplicates.map((rd: any) => {
        const removed = Array.isArray(rd.removedIds) ? rd.removedIds : [];
        removed.forEach((id: string) => removedIds.add(id));
        return {
          keptId: String(rd.keptId || ""),
          removedIds: removed.map(String),
          reason: String(rd.reason || ""),
        };
      })
    : [];
  // Also collect IDs referenced via originalIds in merged messages
  for (const m of messages) {
    if (m.originalIds) {
      m.originalIds.forEach((id) => removedIds.add(id));
    }
  }

  // Warn (but don't fail) if some original IDs are missing
  for (const orig of originalMessages) {
    if (!resultIds.has(orig.id) && !removedIds.has(orig.id)) {
      console.warn(`[idea-processing] Original message ${orig.id} not found in result or removedDuplicates`);
    }
  }

  const groups = Array.isArray(parsed.groups)
    ? parsed.groups.map((g: any) => ({
        name: String(g.name || ""),
        messageIds: Array.isArray(g.messageIds) ? g.messageIds.map(String) : [],
      }))
    : [];

  return {
    messages,
    removedDuplicates,
    groups,
    summary: String(parsed.summary || ""),
  };
}
