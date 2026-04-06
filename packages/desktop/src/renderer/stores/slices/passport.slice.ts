import type { IdeaProcessingMode, IdeaProcessingResult } from "@ccdoc/core";
import { PLAN_VERIFICATION_BLOCK } from "../llm/verification-constants.js";
import type { TreeNode, SliceCreator } from "../types.js";
import {
  estimateInputTokens,
  formatCompactTree,
  buildSlugMap,
} from "../../llm-utils.js";
import { buildIdeaProcessingPrompt, parseProcessingResult } from "../llm/idea-processing-prompt.js";
import { buildPlanPhasesPrompt, parsePhasesResult } from "../llm/plan-phases-prompt.js";
import { callLlmOnceTier, callTierRaw, extractResponseText } from "../llm-engine.js";
import { t as translate } from "../../i18n.js";

/** Source-aware section read for idea helpers. Uses state from the provided getter. */
function _ideaGet(get: () => any) {
  return async (sectionId: string): Promise<any> => {
    const state = get();
    if (state.sectionSource === "user") {
      return window.api.user.get(sectionId);
    }
    const token = state.activeSectionToken || state.currentProject?.token;
    if (!token) return null;
    return window.api.getSection(token, sectionId);
  };
}

function _ideaSave(get: () => any) {
  return async (sectionId: string, title: string, content: string): Promise<void> => {
    const state = get();
    if (state.sectionSource === "user") {
      await window.api.user.update(sectionId, title, content);
    } else {
      const token = state.activeSectionToken || state.currentProject?.token;
      if (!token) return;
      await window.api.updateSection(token, sectionId, title, content);
    }
  };
}

export interface PassportSlice {
  passport: Record<string, string>;
  loadPassport: () => Promise<void>;
  setPassportField: (key: string, value: string) => Promise<void>;
  deletePassportField: (key: string) => Promise<void>;
  generatePassport: () => Promise<void>;
  generateSectionSummary: (sectionId: string) => Promise<void>;
  expandIdeaToPlan: (ideaId: string, messageId?: string, messageText?: string, messageImages?: { id: string; name: string; mediaType: string; data: string }[], splitIntoPhases?: boolean) => Promise<string | null>;
  processIdeaWithLLM: (ideaId: string, mode?: IdeaProcessingMode) => void;
  applyIdeaProcessingResult: (ideaId: string, result: IdeaProcessingResult) => Promise<void>;
  ideaProcessingTask: import("../types.js").IdeaProcessingTask | null;
  clearIdeaProcessingTask: () => void;
  openIdeaProcessingResult: () => Promise<void>;
  addIdeaMessage: (sectionId: string, text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<{ id: string; text: string; createdAt: number }>;
  deleteIdeaMessage: (sectionId: string, messageId: string) => Promise<void>;
  permanentDeleteIdeaMessage: (messageId: string) => Promise<void>;
  restoreIdeaMessage: (messageId: string) => Promise<{ success: boolean; error?: string }>;
  emptyIdeaTrash: () => Promise<void>;
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
    const { currentProject, modelTiers, passport, setPassportField, startBgTask, finishBgTask } = get();
    if (!currentProject?.token) return;
    const tierName = modelTiers.passportTier;
    const tierConfig = modelTiers[tierName];
    const taskId = startBgTask(translate(get().language as any, "bgGeneratingPassport"));
    try {
      const token = currentProject.token;
      const tree = await window.api.getTree(token);
      const treeText = formatCompactTree(tree, 0, false);

      // Collect section content with a total budget of ~20000 chars
      const collectIds = (nodes: any[]): string[] => {
        const ids: string[] = [];
        for (const n of nodes) {
          if (n.type === "page" || n.type === "idea") ids.push(n.id);
          if (n.children?.length) ids.push(...collectIds(n.children));
        }
        return ids;
      };
      const sectionSamples: string[] = [];
      let totalChars = 0;
      const BUDGET = 20000;
      for (const id of collectIds(tree)) {
        if (totalChars >= BUDGET) break;
        try {
          const content = await window.api.getSectionContent(token, id, "markdown");
          if (content?.trim()) {
            const slice = content.slice(0, Math.min(2000, BUDGET - totalChars));
            sectionSamples.push(slice);
            totalChars += slice.length;
          }
        } catch {}
      }

      // Source code context (may not be available)
      let sourceTree = "";
      let readmeContent = "";
      let packageJson = "";
      let claudeMd = "";
      try { sourceTree = await window.api.sourceTree(token, undefined, 3); } catch {}
      try {
        const readme = await window.api.sourceRead(token, "README.md");
        if (readme) readmeContent = (typeof readme === "string" ? readme : readme.content || "").slice(0, 5000);
      } catch {}
      try {
        const pkg = await window.api.sourceRead(token, "package.json");
        if (pkg) packageJson = (typeof pkg === "string" ? pkg : pkg.content || "").slice(0, 2000);
      } catch {}
      try {
        const claude = await window.api.sourceRead(token, "CLAUDE.md");
        if (claude) claudeMd = (typeof claude === "string" ? claude : claude.content || "").slice(0, 5000);
      } catch {}
      // Try alternative build configs if no package.json
      if (!packageJson) {
        for (const cfg of ["Cargo.toml", "pyproject.toml", "go.mod", "Makefile"]) {
          try {
            const f = await window.api.sourceRead(token, cfg);
            if (f) { packageJson = (typeof f === "string" ? f : f.content || "").slice(0, 2000); break; }
          } catch {}
        }
      }

      // Build current values string
      const currentValues = ["name", "description", "stack", "architecture", "conventions", "commands", "structure", "notes"]
        .map((k) => `- ${k}: ${passport[k] || "(empty)"}`)
        .join("\n");

      const prompt = `Analyze this project comprehensively and generate a detailed project passport.

## Documentation tree:
${treeText.slice(0, 5000)}

## Documentation content:
${sectionSamples.join("\n---\n")}
${sourceTree ? `\n## Source code structure:\n${sourceTree.slice(0, 5000)}` : ""}
${readmeContent ? `\n## README.md:\n${readmeContent}` : ""}
${packageJson ? `\n## Build config:\n${packageJson}` : ""}
${claudeMd ? `\n## CLAUDE.md:\n${claudeMd}` : ""}

## Current passport values:
${currentValues}

Generate a JSON object with these fields (all values are strings, use \\n for newlines within values):
- "name": project name (short, 2-5 words)
- "description": what this project is, what problem it solves, who it's for (2-5 sentences)
- "stack": technology stack — languages, frameworks, databases, tools (comma-separated)
- "architecture": architecture overview — layers, modules, key patterns, data flow (detailed paragraph)
- "conventions": code conventions — naming, file organization, patterns, rules (detailed paragraph)
- "commands": build/run/test/dev commands, one per line (e.g. "npm run dev — start dev server\\nnpm test — run tests")
- "structure": key directories and files with one-line descriptions, one per line
- "notes": important gotchas, limitations, things a new developer should know

Be thorough and specific. Each field should contain maximum useful information for an AI assistant working with this project.

Only output valid JSON, nothing else.`;

      const passportSystem = "You are an expert software analyst. Analyze the provided project information and generate a comprehensive project passport. Respond only with valid JSON.";
      const passportMessages = [{ role: "user", content: prompt }];
      get().updateBgTask(taskId, { tokens: { input: estimateInputTokens(passportSystem, passportMessages), output: 0 } });
      const data = await callTierRaw("passportTier", {
        system: passportSystem,
        messages: passportMessages,
        ...(tierConfig.thinking ? { thinking: { type: "enabled", budget_tokens: tierConfig.thinkingBudget } } : {}),
      });

      if (data.usage) {
        get().updateBgTask(taskId, {
          tokens: { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 },
        });
      }

      const text = extractResponseText(data);
      if (text) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const key of ["name", "description", "stack", "architecture", "conventions", "commands", "structure", "notes"]) {
            if (parsed[key]) await setPassportField(key, parsed[key]);
          }
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
    const { currentProject, modelTiers, language } = get();
    if (!currentProject?.token) return;
    const tierConfig = modelTiers[modelTiers.summaryTier];
    try {
      let content = await window.api.getSectionContent(currentProject.token, sectionId, "markdown");

      // For files: own content may be empty (split into child sections). Aggregate children.
      if (!content?.trim()) {
        try {
          const { sections: children } = await window.api.getFileWithSections(currentProject.token, sectionId);
          if (children?.length) {
            const parts: string[] = [];
            for (const child of children) {
              const childContent = await window.api.getSectionContent(currentProject.token, child.id, "markdown");
              if (childContent?.trim()) parts.push(`## ${child.title}\n${childContent}`);
            }
            content = parts.join("\n\n");
          }
        } catch { /* not a file or no children — skip */ }
      }
      if (!content?.trim()) return;

      const langInstruction = language === "ru" ? "Respond in Russian." : "Respond in English.";
      const summarySystem = `You are a helpful assistant. Write a single short sentence (up to 100 characters) summarizing what this document is about. Output only the sentence, nothing else. ${langInstruction}`;
      const summaryMessages = [{ role: "user", content: content.slice(0, 3000) }];
      const data = await callTierRaw("summaryTier", {
        system: summarySystem,
        messages: summaryMessages,
        ...(tierConfig.thinking ? { thinking: { type: "enabled", budget_tokens: tierConfig.thinkingBudget } } : {}),
      });

      const summary = extractResponseText(data)?.trim() || null;
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
    }
  },

  expandIdeaToPlan: async (ideaId: string, messageId?: string, messageText?: string, messageImages?: { id: string; name: string; mediaType: string; data: string }[], splitIntoPhases: boolean = true) => {
    const { currentProject, language, tree, sectionSource, userTree } = get();
    const isUser = sectionSource === "user";
    if (!isUser && !currentProject?.token) return null;
    if (!get().hasLlmAccess()) return null;

    let content: string;
    if (messageText) {
      content = messageText;
    } else if (isUser) {
      content = await window.api.user.getContent(ideaId, "markdown");
    } else {
      content = await window.api.getSectionContent(currentProject!.token, ideaId, "markdown");
    }
    if (!content?.trim()) return null;

    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return null;
    };
    const activeTree = isUser ? userTree : tree;
    const ideaNode = findNode(activeTree, ideaId);
    const ideaTitle = ideaNode?.title || "Idea";

    // Pre-seed: compact doc tree (depth=2) and source tree (depth=2) — just structure, not content
    const docTree = formatCompactTree(tree, 0, true, 2, buildSlugMap(tree));
    let sourceTree = "";
    try {
      sourceTree = await window.api.sourceTree(currentProject.token, undefined, 2);
    } catch { /* project may not have source path */ }

    // Pre-seed: try to find architecture description for project context
    let archSummary = "";
    try {
      const allChildren = tree.flatMap((n: TreeNode) => n.children || []);
      const arch = allChildren.find((c: TreeNode) =>
        c.title.toLowerCase().includes("architect") || c.title.toLowerCase().includes("архитектур")
      );
      if (arch) {
        const archContent = await window.api.getSectionContent(currentProject.token, arch.id, "plain");
        if (archContent && typeof archContent === "string" && archContent.trim()) {
          archSummary = `\n\n--- Architecture summary ---\n${archContent.slice(0, 3000)}`;
        }
      }
    } catch { /* skip */ }

    const preSeedSection = `--- Documentation structure ---\n${docTree}` +
      (sourceTree ? `\n\n--- Source code structure (top level) ---\n${sourceTree}` : "") +
      archSummary;

    const message = `Create a detailed implementation plan for the idea below.

Process:
1. Read relevant documentation sections (structure is provided below)
2. Explore project source code (use get_file_outlines for multiple files at once, find_symbols to locate symbols)
3. Create the plan via create_section(parent_id="${ideaId}", type="section", title="<descriptive title>", content="...")

IMPORTANT: The plan title must reflect the ESSENCE of the idea, not just "Implementation Plan". Good examples: "Quiet mode for external DB changes", "PDF export for sections", "Documentation tree caching".

Plan must include: summary, architecture, step-by-step implementation, key files, risks, testing strategy.

At the very end of the plan, you MUST add a section "✅ Mandatory result verification" with two iterations:
- Iteration 1: check plan compliance → check for errors → fix.
- Iteration 2: re-check plan compliance → re-check for errors → fix.
The executor MUST NOT report completion until both iterations pass.

IMPORTANT: Explore documentation and code BEFORE writing the plan.

${preSeedSection}

CRITICAL: Write ALL responses, plan content, and section titles in ${language === "ru" ? "Russian" : "English"}. Every tool call content parameter must also be in ${language === "ru" ? "Russian" : "English"}.

---

Idea:
${content}`;

    const displayText = `Creating plan: ${ideaTitle}

${content}`;

    // Start a new LLM session (saves current one if any)
    get().clearLlmMessages();
    // Configure agent settings: source code ON, context OFF (plan has its own context)
    // Set session context so engine can auto-link plan to idea message
    set({
      llmPanelOpen: true,
      llmIncludeSourceCode: true,
      llmIncludeContext: false,
      llmSessionContext: {
        mode: "plan",
        ideaId,
        messageId,
        projectToken: currentProject?.token,
      },
    });
    // Convert idea images to LLM attachments for vision
    const attachments = messageImages?.length
      ? messageImages.map(img => ({ type: "image" as const, name: img.name, mediaType: img.mediaType, data: img.data }))
      : undefined;
    const planId = await get().sendLlmMessage(message, false, attachments, true, displayText, true);
    console.log("[expandIdeaToPlan] planId from sendLlmMessage:", planId);
    if (isUser) await get().loadUserTree(); else await get().loadTree();

    const getSection = _ideaGet(get);
    const saveSection = _ideaSave(get);

    // Link the newly created plan child to the specific message
    if (messageId && planId) {
      try {
        const sec = await getSection(ideaId);
        if (sec) {
          const data = JSON.parse(sec.content);
          const msg = data.messages?.find((m: any) => m.id === messageId);
          if (msg) {
            msg.planId = planId;
            await saveSection(ideaId, sec.title, JSON.stringify(data));
          }
        }
      } catch { /* ignore */ }
    }

    // Split plan into phases via a second LLM call
    console.log("[expandIdeaToPlan] splitIntoPhases:", splitIntoPhases, "planId:", planId, "hasAccess:", get().hasLlmAccess());
    if (splitIntoPhases && planId && get().hasLlmAccess()) {
      const phaseTaskId = get().startBgTask("📋 Splitting into phases...");
      try {
        let planContent: string;
        if (isUser) {
          planContent = await window.api.user.getContent(planId, "markdown");
        } else {
          planContent = await window.api.getSectionContent(currentProject!.token, planId, "markdown");
        }
        if (planContent?.trim()) {
          const phasesPrompt = buildPlanPhasesPrompt(planContent, language);
          const chatTierConfig = get().modelTiers[get().modelTiers.chatTier];
          const phasesResponse = await callLlmOnceTier(
            phasesPrompt, chatTierConfig,
            "You are a helpful assistant that splits implementation plans into phases. Respond only with markdown.",
          );
          const phases = parsePhasesResult(phasesResponse);
          for (const phase of phases) {
            if (isUser) {
              await window.api.user.create(planId, phase.title, "section", null, phase.content);
            } else {
              await window.api.createSection(currentProject!.token, planId, phase.title, "section", null, phase.content);
            }
          }
          // Add verification phase as last child (if auto-verify enabled and not already present)
          const alreadyHasVerify = phases.some(p => /верификац|verification/i.test(p.title));
          if (phases.length > 0 && get().autoVerifyPlan && !alreadyHasVerify) {
            const verifyTitle = "✅ Result verification";
            if (isUser) {
              await window.api.user.create(planId, verifyTitle, "section", null, PLAN_VERIFICATION_BLOCK.trim());
            } else {
              await window.api.createSection(currentProject!.token, planId, verifyTitle, "section", null, PLAN_VERIFICATION_BLOCK.trim());
            }
          }
          if (phases.length > 0) {
            if (isUser) await get().loadUserTree(); else await get().loadTree();
          }
        }
      } catch (e) {
        console.error("[expandIdeaToPlan] phase splitting failed:", e);
      } finally {
        get().finishBgTask(phaseTaskId);
      }
    }

    // Navigate back to the idea
    try {
      if (isUser) await get().selectUserSection(ideaId);
      else await get().selectSection(ideaId);
    } catch { /* ignore */ }

    return null;
  },

  ideaProcessingTask: null,

  processIdeaWithLLM: (ideaId: string, mode: IdeaProcessingMode = "full") => {
    const { currentProject, language, tree, sectionSource, userTree } = get();
    const isUserProc = sectionSource === "user";
    if (!isUserProc && !currentProject?.token) return;
    if (!get().hasLlmAccess()) return;

    // Find idea title for status bar
    const findNode = (nodes: any[], id: string): any => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children || [], id);
        if (found) return found;
      }
      return null;
    };
    const ideaNode = findNode(isUserProc ? userTree : tree, ideaId);
    const sectionTitle = ideaNode?.title || "Ideas";

    const ru = language === "ru";
    const modeLabels: Record<string, string> = {
      title:       "Generating titles",
      polish:      "Polishing text",
      deduplicate: "Deduplication",
      group:       "Grouping",
      full:        "Full processing",
    };
    const modeLabel = modeLabels[mode] || modeLabels.full;
    const bgTaskId = get().startBgTask(`✨ ${modeLabel}: ${sectionTitle}`);

    // Fire-and-forget: run in background
    (async () => {
      try {
        const section = await _ideaGet(get)(ideaId);
        let data: { messages: any[]; kanbanId?: string };
        try {
          const parsed = JSON.parse(section.content);
          data = parsed.type === "doc" ? { messages: [] } : parsed;
        } catch { data = { messages: [] }; }

        if (data.messages.length < 2) {
          get().finishBgTask(bgTaskId);
          return;
        }

        set({
          ideaProcessingTask: {
            bgTaskId,
            sectionId: ideaId,
            sectionTitle,
            mode,
            status: "processing",
            result: null,
            originalMessages: data.messages,
          },
        });

        const prompt = buildIdeaProcessingPrompt(data.messages, mode, ru ? "ru" : "en");
        const chatTierCfg = get().modelTiers[get().modelTiers.chatTier];
        const response = await callLlmOnceTier(prompt, chatTierCfg);
        const result = parseProcessingResult(response, data.messages);

        // Update bg task label to show completion
        get().updateBgTask(bgTaskId, { label: `✅ Processing done: ${sectionTitle}` });

        set({
          ideaProcessingTask: {
            bgTaskId,
            sectionId: ideaId,
            sectionTitle,
            mode,
            status: "done",
            result,
            originalMessages: data.messages,
          },
        });
      } catch (e: any) {
        console.error("Idea processing error:", e);
        get().updateBgTask(bgTaskId, { label: `❌ Processing error: ${sectionTitle}` });
        set({
          ideaProcessingTask: {
            bgTaskId,
            sectionId: ideaId,
            sectionTitle,
            mode,
            status: "error",
            result: null,
            originalMessages: null,
            error: e?.message || String(e),
          },
        });
        // Auto-cleanup error after 8 seconds
        setTimeout(() => get().clearIdeaProcessingTask(), 8000);
      }
    })();
  },

  clearIdeaProcessingTask: () => {
    const task = get().ideaProcessingTask;
    if (task) {
      get().finishBgTask(task.bgTaskId);
    }
    set({ ideaProcessingTask: null });
  },

  openIdeaProcessingResult: async () => {
    const task = get().ideaProcessingTask;
    if (!task || task.status !== "done") return;
    // Navigate to the idea section
    try { await get().selectSection(task.sectionId); } catch { /* ignore */ }
  },

  applyIdeaProcessingResult: async (ideaId: string, result: IdeaProcessingResult) => {
    const getSection = _ideaGet(get);
    const saveSection = _ideaSave(get);
    const isUser = get().sectionSource === "user";

    const section = await getSection(ideaId);
    if (!section) return;
    let data: { messages: any[]; kanbanId?: string };
    try {
      data = JSON.parse(section.content);
    } catch { data = { messages: [] }; }

    const newData = { messages: result.messages, ...(data.kanbanId ? { kanbanId: data.kanbanId } : {}) };
    await saveSection(ideaId, section.title, JSON.stringify(newData));

    get().clearIdeaProcessingTask();

    if (isUser) { await get().loadUserTree(); await get().selectUserSection(ideaId); }
    else { await get().loadTree(); try { await get().selectSection(ideaId); } catch { /* ignore */ } }
  },

  addIdeaMessage: async (sectionId: string, text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => {
    const getSection = _ideaGet(get);
    const saveSection = _ideaSave(get);

    const section = await getSection(sectionId);
    if (!section) throw new Error("Section not found");
    let data: { messages: any[]; kanbanId?: string };
    try {
      const parsed = JSON.parse(section.content);
      data = parsed.type === "doc" ? { messages: [] } : parsed;
    } catch { data = { messages: [] }; }

    const msg: any = { id: crypto.randomUUID(), text, createdAt: Date.now() };
    if (images && images.length > 0) msg.images = images;
    data.messages.push(msg);

    await saveSection(sectionId, section.title, JSON.stringify(data));

    // Sync: add card to linked kanban board
    if (data.kanbanId) {
      try {
        const kanbanSection = await getSection(data.kanbanId);
        if (kanbanSection) {
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
            await saveSection(data.kanbanId, kanbanSection.title, JSON.stringify(kanbanData));
          }
        }
      } catch { /* kanban may be deleted */ }
    }

    return msg;
  },

  deleteIdeaMessage: async (sectionId: string, messageId: string) => {
    const isUser = get().sectionSource === "user";
    const token = isUser ? "__user__" : (get().activeSectionToken || get().currentProject?.token);
    if (!token) return;

    await window.api.idea.deleteMessage(token, sectionId, messageId);

    // Reload tree (to reflect plan deletion in sidebar + trash folder in user tree)
    if (isUser) await get().loadUserTree();
    else {
      await get().loadTree();
      await get().loadUserTree(); // trash folder may have been created
    }
  },

  permanentDeleteIdeaMessage: async (messageId: string) => {
    await window.api.idea.permanentDelete(messageId);
    await get().loadUserTree();
  },

  restoreIdeaMessage: async (messageId: string) => {
    const result = await window.api.idea.restoreMessage(messageId);
    await get().loadUserTree();
    if (result.success) {
      const isUser = get().sectionSource === "user";
      if (!isUser) await get().loadTree();
    }
    return result;
  },

  emptyIdeaTrash: async () => {
    await window.api.idea.emptyTrash();
    await get().loadUserTree();
  },

  getIdeaMessages: async (sectionId: string) => {
    const getSection = _ideaGet(get);
    const section = await getSection(sectionId);
    if (!section) return [];
    try {
      const parsed = JSON.parse(section.content);
      if (parsed.type === "doc") {
        // Legacy single-text format — try to read plain text
        const isUser = get().sectionSource === "user";
        let text = "";
        if (isUser) {
          text = await window.api.user.getContent(sectionId, "plain");
        } else {
          const token = get().activeSectionToken || get().currentProject?.token;
          if (token) text = await window.api.getSectionContent(token, sectionId, "plain");
        }
        return text?.trim() ? [{ id: "legacy", text, createdAt: Date.parse(section.created_at) }] : [];
      }
      return parsed.messages || [];
    } catch { return []; }
  },
});
