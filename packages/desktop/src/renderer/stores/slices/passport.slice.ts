import type { TreeNode, SliceCreator } from "../types.js";
import {
  estimateInputTokens,
  formatCompactTree,
} from "../../llm-utils.js";

export interface PassportSlice {
  passport: Record<string, string>;
  loadPassport: () => Promise<void>;
  setPassportField: (key: string, value: string) => Promise<void>;
  deletePassportField: (key: string) => Promise<void>;
  generatePassport: () => Promise<void>;
  generateSectionSummary: (sectionId: string) => Promise<void>;
  expandIdeaToPlan: (ideaId: string, messageId?: string, messageText?: string, messageImages?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<string | null>;
  addIdeaMessage: (sectionId: string, text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<{ id: string; text: string; createdAt: number }>;
  deleteIdeaMessage: (sectionId: string, messageId: string) => Promise<void>;
  getIdeaMessages: (sectionId: string) => Promise<{ id: string; text: string; createdAt: number; planId?: string; images?: { id: string; name: string; mediaType: string; data: string }[] }[]>;
}

export const createPassportSlice: SliceCreator<PassportSlice> = (set, get) => ({
  passport: {},

  loadPassport: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ passport: {} });
    try {
      const passport = await window.api.getPassport(currentProject.token);
      set({ passport });
    } catch (e: any) {
      console.warn("Failed to load passport:", e.message);
    }
  },

  setPassportField: async (key, value) => {
    const { currentProject } = get();
    if (!currentProject) return;
    await window.api.setPassportField(currentProject.token, key, value);
    set((s) => ({ passport: { ...s.passport, [key]: value } }));
  },

  generatePassport: async () => {
    const { currentProject, llmApiKey, llmPassportConfig, passport, setPassportField, startBgTask, finishBgTask } = get();
    const { model, maxTokens, temperature, thinking, thinkingBudget } = llmPassportConfig;
    if (!currentProject?.token || !llmApiKey) return;
    const taskId = startBgTask("Генерация паспорта проекта");
    try {
      const tree = await window.api.getTree(currentProject.token);
      const treeText = JSON.stringify(tree, null, 2);

      const collectIds = (nodes: any[]): string[] => {
        const ids: string[] = [];
        for (const n of nodes) {
          if (n.type === "page" || n.type === "idea") ids.push(n.id);
          if (n.children?.length) ids.push(...collectIds(n.children));
        }
        return ids;
      };
      const sectionSamples: string[] = [];
      for (const id of collectIds(tree).slice(0, 5)) {
        try {
          const content = await window.api.getSectionContent(currentProject.token, id, "markdown");
          if (content?.trim()) sectionSamples.push(content.slice(0, 500));
        } catch {}
      }

      const prompt = `Analyze this documentation project and generate a passport.

Tree structure:
${treeText.slice(0, 3000)}

Sample content from sections:
${sectionSamples.join("\n---\n")}

Current passport values:
- Name: ${passport.name || "(empty)"}
- Stack: ${passport.stack || "(empty)"}
- Conventions: ${passport.conventions || "(empty)"}

Based on the project structure and content, generate a JSON object with these fields:
- "name": project name (string, short)
- "stack": technology stack used (string, comma-separated)
- "conventions": code conventions observed (string)

Only output valid JSON, nothing else.`;

      const passportSystem = "You are a helpful assistant that analyzes documentation projects. Respond only with valid JSON.";
      const passportMessages = [{ role: "user", content: prompt }];
      get().updateBgTask(taskId, { tokens: { input: estimateInputTokens(passportSystem, passportMessages), output: 0 } });
      const data = await window.api.llmChat({
        apiKey: llmApiKey,
        system: passportSystem,
        messages: passportMessages,
        model,
        maxTokens: thinking ? Math.max(maxTokens, thinkingBudget + 1024) : maxTokens,
        temperature: thinking ? 1.0 : temperature,
        ...(thinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
      });

      if (data.usage) {
        get().updateBgTask(taskId, {
          tokens: { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 },
        });
      }

      const textBlock = data.content?.find((b: any) => b.type === "text");
      if (textBlock?.text) {
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.name) await setPassportField("name", parsed.name);
          if (parsed.stack) await setPassportField("stack", parsed.stack);
          if (parsed.conventions) await setPassportField("conventions", parsed.conventions);
        }
      }
    } catch (err) {
      console.error("Auto passport generation failed:", err);
    } finally {
      finishBgTask(taskId);
    }
  },

  deletePassportField: async (key) => {
    const { currentProject } = get();
    if (!currentProject) return;
    await window.api.deletePassportField(currentProject.token, key);
    set((s) => {
      const { [key]: _, ...rest } = s.passport;
      return { passport: rest };
    });
  },

  generateSectionSummary: async (sectionId: string) => {
    const { currentProject, llmApiKey, llmSummaryConfig, language, startBgTask, finishBgTask, updateBgTask } = get();
    const { model, maxTokens, temperature, thinking, thinkingBudget } = llmSummaryConfig;
    if (!currentProject?.token || !llmApiKey) return;
    const taskId = startBgTask(language === "ru" ? "Генерация саммари" : "Generating summary");
    try {
      const content = await window.api.getSectionContent(currentProject.token, sectionId, "markdown");
      if (!content?.trim()) return;

      const langInstruction = language === "ru" ? "Respond in Russian." : "Respond in English.";
      const summarySystem = `You are a helpful assistant. Write a single short sentence (up to 100 characters) summarizing what this document is about. Output only the sentence, nothing else. ${langInstruction}`;
      const summaryMessages = [{ role: "user", content: content.slice(0, 3000) }];
      updateBgTask(taskId, { tokens: { input: estimateInputTokens(summarySystem, summaryMessages), output: 0 } });
      const data = await window.api.llmChat({
        apiKey: llmApiKey,
        system: summarySystem,
        messages: summaryMessages,
        model,
        maxTokens,
        temperature: thinking ? 1.0 : temperature,
        ...(thinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
      });

      if (data.usage) {
        updateBgTask(taskId, {
          tokens: { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 },
        });
      }

      const textBlock = data.content?.find((b: any) => b.type === "text");
      const summary = textBlock?.text?.trim() || null;
      if (!summary) return;

      await window.api.setSectionSummary(currentProject.token, sectionId, summary);

      // Update the node in the tree state without full reload
      const updateNode = (nodes: any[]): any[] =>
        nodes.map((n) =>
          n.id === sectionId
            ? { ...n, summary }
            : { ...n, children: updateNode(n.children) }
        );
      set((s) => ({ tree: updateNode(s.tree) }));
    } catch (err) {
      console.error("[generateSectionSummary] failed:", err);
    } finally {
      finishBgTask(taskId);
    }
  },

  expandIdeaToPlan: async (ideaId: string, messageId?: string, messageText?: string, messageImages?: { id: string; name: string; mediaType: string; data: string }[]) => {
    const { currentProject, llmApiKey, language, tree } = get();
    if (!currentProject?.token || !llmApiKey) return null;

    const content = messageText || await window.api.getSectionContent(currentProject.token, ideaId, "markdown");
    if (!content?.trim()) return null;

    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return null;
    };
    const ideaNode = findNode(tree, ideaId);
    const ideaTitle = ideaNode?.title || "Idea";

    // Remember existing plan child IDs before LLM creates a new one
    const existingChildIds = new Set(
      (ideaNode?.children || []).filter((c: TreeNode) => c.type === "section").map((c: TreeNode) => c.id)
    );

    // Pre-seed: fetch doc tree and source tree upfront to save round-trips
    const docTree = formatCompactTree(tree);
    let sourceTree = "";
    try {
      sourceTree = await window.api.sourceTree(currentProject.token);
    } catch { /* project may not have source path */ }

    // Pre-seed: fetch content of sibling doc sections (same parent folder) to save 1-2 research rounds
    let siblingContext = "";
    try {
      const findParent = (nodes: TreeNode[], targetId: string, parent: TreeNode | null = null): TreeNode | null => {
        for (const n of nodes) {
          if (n.id === targetId) return parent;
          const found = findParent(n.children, targetId, n);
          if (found) return found;
        }
        return null;
      };
      const parentNode = findParent(tree, ideaId);
      if (parentNode) {
        const siblings = parentNode.children
          .filter((c: TreeNode) => c.id !== ideaId && ["file", "idea"].includes(c.type))
          .slice(0, 5); // max 5 siblings to keep context reasonable
        if (siblings.length > 0) {
          const siblingIds = siblings.map((s: TreeNode) => s.id);
          const siblingContents: string[] = [];
          for (const sid of siblingIds) {
            try {
              const sc = await window.api.getSectionContent(currentProject.token, sid, "markdown");
              if (sc && typeof sc === "string" && sc.trim()) {
                const sNode = siblings.find((s: TreeNode) => s.id === sid);
                siblingContents.push(`### ${sNode?.title || "?"}\n${sc.slice(0, 2000)}`);
              }
            } catch { /* skip */ }
          }
          if (siblingContents.length > 0) {
            siblingContext = `\n\n--- Контент связанных секций (уже прочитан, не нужно запрашивать повторно) ---\n${siblingContents.join("\n\n")}`;
          }
        }
      }
    } catch { /* ignore */ }

    const ru = language === "ru";
    const preSeedSection = `--- Структура документации ---\n${docTree}` +
      (sourceTree ? `\n\n--- Файлы исходного кода ---\n${sourceTree}` : "") +
      siblingContext;

    const message = ru
      ? `Создай детальный план реализации для идеи ниже.

Процесс:
1. Прочитай релевантные секции документации (структура уже ниже)
2. Изучи исходный код проекта (используй get_file_outlines для нескольких файлов сразу, find_symbols для поиска символов)
3. Создай план через create_section(parent_id="${ideaId}", type="section", title="<описательное название>", content="...")

ВАЖНО: Название плана должно отражать СУТЬ идеи, а не просто "План реализации". Примеры хороших названий: "Тихий режим при внешних изменениях БД", "Экспорт секций в PDF", "Кэширование дерева документации".

План должен включать: резюме, архитектуру, пошаговую реализацию, ключевые файлы, риски, стратегию тестирования.

ВАЖНО: Исследуй документацию и код, потом пиши план. Отвечай на русском.

${preSeedSection}

---

Идея:
${content}`
      : `Create a detailed implementation plan for the idea below.

Process:
1. Read relevant documentation sections (structure is provided below)
2. Explore project source code (use get_file_outlines for multiple files at once, find_symbols to locate symbols)
3. Create the plan via create_section(parent_id="${ideaId}", type="section", title="<descriptive title>", content="...")

IMPORTANT: The plan title must reflect the ESSENCE of the idea, not just "Implementation Plan". Good examples: "Quiet mode for external DB changes", "PDF export for sections", "Documentation tree caching".

Plan must include: summary, architecture, step-by-step implementation, key files, risks, testing strategy.

IMPORTANT: Explore documentation and code BEFORE writing the plan. Respond in English.

${preSeedSection}

---

Idea:
${content}`;

    const displayText = ru
      ? `Создание плана: ${ideaTitle}\n\n${content}`
      : `Creating plan: ${ideaTitle}\n\n${content}`;

    // Start a new LLM session (saves current one if any)
    get().clearLlmMessages();
    // Configure agent settings: source code ON, context OFF (plan has its own context)
    set({ llmPanelOpen: true, llmIncludeSourceCode: true, llmIncludeContext: false });
    // Convert idea images to LLM attachments for vision
    const attachments = messageImages?.length
      ? messageImages.map(img => ({ type: "image" as const, name: img.name, mediaType: img.mediaType, data: img.data }))
      : undefined;
    await get().sendLlmMessage(message, false, attachments, true, displayText, true);
    await get().loadTree();

    // Link the newly created plan child to the specific message
    if (messageId && currentProject?.token) {
      try {
        const updatedIdeaNode = findNode(get().tree, ideaId);
        const newChildren = (updatedIdeaNode?.children || [])
          .filter((c: TreeNode) => c.type === "section" && !existingChildIds.has(c.id));
        if (newChildren.length > 0) {
          const sec = await window.api.getSection(currentProject.token, ideaId);
          const data = JSON.parse(sec.content);
          const msg = data.messages?.find((m: any) => m.id === messageId);
          if (msg) {
            msg.planId = newChildren[0].id;
            await window.api.updateSection(currentProject.token, ideaId, sec.title, JSON.stringify(data));
          }
        }
      } catch { /* ignore */ }
    }

    // Navigate back to the idea
    try { await get().selectSection(ideaId); } catch { /* ignore */ }

    return null;
  },

  addIdeaMessage: async (sectionId: string, text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => {
    const { currentProject } = get();
    if (!currentProject?.token) throw new Error("No project");

    const section = await window.api.getSection(currentProject.token, sectionId);
    let data: { messages: any[]; kanbanId?: string };
    try {
      const parsed = JSON.parse(section.content);
      data = parsed.type === "doc" ? { messages: [] } : parsed;
    } catch { data = { messages: [] }; }

    const msg: any = { id: crypto.randomUUID(), text, createdAt: Date.now() };
    if (images && images.length > 0) msg.images = images;
    data.messages.push(msg);

    await window.api.updateSection(currentProject.token, sectionId, section.title, JSON.stringify(data));

    // Sync: add card to linked kanban board
    if (data.kanbanId) {
      try {
        const kanbanSection = await window.api.getSection(currentProject.token, data.kanbanId);
        const kanbanData = JSON.parse(kanbanSection.content);
        const backlogCol = kanbanData.columns?.[0];
        if (backlogCol) {
          const lines = text.trim().split("\n");
          backlogCol.cards.push({
            id: crypto.randomUUID(),
            title: lines[0] || text,
            description: lines.slice(1).join("\n").trim(),
            labels: [],
            checked: false,
            properties: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sourceIdeaId: sectionId,
            sourceMessageId: msg.id,
          });
          await window.api.updateSection(currentProject.token, data.kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
        }
      } catch { /* kanban may be deleted */ }
    }

    return msg;
  },

  deleteIdeaMessage: async (sectionId: string, messageId: string) => {
    const { currentProject } = get();
    if (!currentProject?.token) return;

    const section = await window.api.getSection(currentProject.token, sectionId);
    let data: { messages: any[]; kanbanId?: string };
    try { data = JSON.parse(section.content); } catch { return; }

    const msg = data.messages.find((m: any) => m.id === messageId);

    // Delete plan section directly via IPC (without triggering loadTree mid-operation
    // which causes a race condition: useEffect re-reads old messages before they're removed)
    if (msg?.planId) {
      await window.api.deleteSection(currentProject.token, msg.planId);
    }

    // Remove the message from content
    data.messages = data.messages.filter((m: any) => m.id !== messageId);
    await window.api.updateSection(currentProject.token, sectionId, section.title, JSON.stringify(data));

    // Remove linked kanban card via kanbanId (preferred) or sibling fallback
    const kanbanId = data.kanbanId;
    if (kanbanId) {
      try {
        const kanbanSection = await window.api.getSection(currentProject.token, kanbanId);
        const kanbanData = JSON.parse(kanbanSection.content);
        let changed = false;
        for (const col of kanbanData.columns ?? []) {
          const before = col.cards.length;
          col.cards = col.cards.filter((c: any) => c.sourceMessageId !== messageId);
          if (col.cards.length < before) changed = true;
        }
        if (changed) {
          await window.api.updateSection(currentProject.token, kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
        }
      } catch { /* kanban may be deleted */ }
    } else if (section.parent_id) {
      // Fallback: find sibling kanban boards via tree (for old kanban links without kanbanId)
      try {
        const tree = get().tree;
        const findNode = (nodes: any[], id: string): any => {
          for (const n of nodes) {
            if (n.id === id) return n;
            const found = findNode(n.children ?? [], id);
            if (found) return found;
          }
          return null;
        };
        const parent = findNode(tree, section.parent_id);
        const kanbanSiblings = (parent?.children ?? []).filter((c: any) => c.type === "kanban");
        for (const sib of kanbanSiblings) {
          const kanbanSection = await window.api.getSection(currentProject.token, sib.id);
          let kanbanData: any;
          try { kanbanData = JSON.parse(kanbanSection.content); } catch { continue; }
          let changed = false;
          for (const col of kanbanData.columns ?? []) {
            const before = col.cards.length;
            col.cards = col.cards.filter((c: any) => c.sourceMessageId !== messageId);
            if (col.cards.length < before) changed = true;
          }
          if (changed) {
            await window.api.updateSection(currentProject.token, sib.id, kanbanSection.title, JSON.stringify(kanbanData));
          }
        }
      } catch { /* ignore */ }
    }

    // Reload tree once at the end (to reflect plan deletion in sidebar)
    await get().loadTree();
  },

  getIdeaMessages: async (sectionId: string) => {
    const { currentProject } = get();
    if (!currentProject?.token) return [];

    const section = await window.api.getSection(currentProject.token, sectionId);
    try {
      const parsed = JSON.parse(section.content);
      if (parsed.type === "doc") {
        const text = await window.api.getSectionContent(currentProject.token, sectionId, "plain");
        return text?.trim() ? [{ id: "legacy", text, createdAt: Date.parse(section.created_at) }] : [];
      }
      return parsed.messages || [];
    } catch { return []; }
  },
});
