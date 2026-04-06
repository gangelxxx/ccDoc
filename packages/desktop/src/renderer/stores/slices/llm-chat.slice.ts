import type { LlmAttachment, LlmMessage, SliceCreator } from "../types.js";
import { sendLlmMessageImpl } from "../llm-engine.js";
import { buildDocTreeSummary, buildDocUpdatePrompt, buildLinkedDocGenPrompt, buildLinkedDocUpdatePrompt } from "../llm/doc-update-prompt.js";

export interface LlmChatSlice {
  llmCurrentPlan: import("../llm/types.js").LlmPlan | null;
  llmMessages: LlmMessage[];
  llmLoading: boolean;
  llmAborted: boolean;
  llmTokensUsed: { input: number; output: number; cacheRead: number; cacheCreation: number };
  llmIncludeContext: boolean;
  llmIncludeSourceCode: boolean;
  /** True when the LLM is waiting for user input via ask_user tool */
  llmWaitingForUser: boolean;
  /** The question text from ask_user */
  llmPendingQuestion: string | null;
  /** Optional answer choices from ask_user */
  llmPendingOptions: string[] | null;
  /** Resolve callback for the ask_user promise */
  llmResolveUserInput: ((answer: string) => void) | null;
  llmTargetProjectToken: string | null;
  setLlmIncludeContext: (v: boolean) => void;
  setLlmIncludeSourceCode: (v: boolean) => void;
  setWaitingForUser: (question: string, options: string[] | null, resolve: (answer: string) => void) => void;
  submitUserAnswer: (answer: string) => void;
  sendLlmMessage: (text: string, includeContext: boolean, attachments?: LlmAttachment[], includeSourceCode?: boolean, displayText?: string, planMode?: boolean) => Promise<string | null>;
  stopLlmChat: () => void;
  retryLlmMessage: (userMsgIndex?: number) => void;
  clearLlmMessages: () => void;
  startDocUpdateSession: () => void;
  startLinkedDocGenSession: (linkedProjectId: string, mode?: "generate" | "update") => void;
  startDocUpdateQueue: (projects: Array<{ type: "main" } | { type: "linked"; linkedProjectId: string; mode: "generate" | "update" }>) => Promise<void>;
}

export const createLlmChatSlice: SliceCreator<LlmChatSlice> = (set, get) => ({
  llmCurrentPlan: null,
  llmMessages: [],
  llmLoading: false,
  llmAborted: false,
  llmTokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  llmIncludeContext: true,
  llmIncludeSourceCode: false,
  llmWaitingForUser: false,
  llmPendingQuestion: null,
  llmPendingOptions: null,
  llmResolveUserInput: null,
  llmSessionContext: null,
  llmTargetProjectToken: null,
  setLlmIncludeContext: (v: boolean) => set({ llmIncludeContext: v }),
  setLlmIncludeSourceCode: (v: boolean) => set({ llmIncludeSourceCode: v }),

  setWaitingForUser: (question, options, resolve) => set({
    llmWaitingForUser: true,
    llmPendingQuestion: question,
    llmPendingOptions: options,
    llmResolveUserInput: resolve,
  }),

  submitUserAnswer: (answer) => {
    const { llmResolveUserInput } = get();
    if (llmResolveUserInput) {
      llmResolveUserInput(answer);
    }
    set({
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
    });
  },

  stopLlmChat: () => {
    // Guard: no-op if already stopped
    if (get().llmAborted && !get().llmLoading) return;
    const { llmResolveUserInput, llmMessages } = get();
    if (llmResolveUserInput) {
      llmResolveUserInput("__ABORTED__");
    }
    // Abort the in-flight HTTP request to Anthropic API in main process
    window.api.llmAbort().catch(() => {});
    // Filter out tool-status messages immediately so UI is clean
    const STATUS_EMOJIS = ["\u{1F527}", "\u{1F504}", "\u{1F50D}", "\u{1F4DD}", "\u{1F4CB}", "\u{1F4D0}"];
    const filtered = llmMessages.filter((m) =>
      typeof m.content !== "string" || !STATUS_EMOJIS.some((e) => (m.content as string).startsWith(e))
    );
    set({
      llmAborted: true,
      llmLoading: false,
      llmMessages: filtered,
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
    });
  },

  retryLlmMessage: (userMsgIndex?: number) => {
    const { llmMessages, llmLoading } = get();
    if (llmLoading) return;
    // Find the user message to retry
    let idx = userMsgIndex;
    if (idx === undefined) {
      // Default: find last user message
      for (let i = llmMessages.length - 1; i >= 0; i--) {
        if (llmMessages[i].role === "user") { idx = i; break; }
      }
    }
    if (idx === undefined || idx < 0 || llmMessages[idx]?.role !== "user") return;
    const userMsg = llmMessages[idx];
    // Extract text from content (may be string or array of content blocks)
    let text: string;
    if (typeof userMsg.content === "string") {
      text = userMsg.content;
    } else if (Array.isArray(userMsg.content)) {
      text = userMsg.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    } else {
      text = "";
    }
    // Remove this message and everything after it, reset token counter, then resend
    set({
      llmMessages: llmMessages.slice(0, idx),
      llmTokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    });
    get().sendLlmMessage(text, true, userMsg.attachments);
  },

  clearLlmMessages: () => {
    // Save current session before clearing (if there are messages)
    const { llmMessages, llmResolveUserInput, llmLoading } = get();
    if (llmMessages.length > 0) {
      get().saveLlmSession();
    }
    // Resolve pending ask_user promise to prevent dangling await
    if (llmResolveUserInput) {
      llmResolveUserInput("__ABORTED__");
    }
    set({
      llmMessages: [],
      llmTokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      llmCurrentSessionId: null,
      llmCurrentPlan: null,
      sessionBuffer: { entries: {}, totalChars: 0 },
      llmLoading: false,
      llmAborted: llmLoading, // signal stale engine to exit
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
      llmSessionContext: null,
      llmTargetProjectToken: null,
    });
  },

  startDocUpdateSession: () => {
    const { currentProject, tree, llmLoading, llmResolveUserInput } = get();
    if (!currentProject || llmLoading) return;

    // Build compact doc tree summary
    const docTree = buildDocTreeSummary(tree);
    const userMessage = buildDocUpdatePrompt(docTree);

    // Save current session if any
    const { llmMessages } = get();
    if (llmMessages.length > 0) {
      get().saveLlmSession();
    }

    // Resolve pending ask_user promise to prevent dangling await
    if (llmResolveUserInput) {
      llmResolveUserInput("__ABORTED__");
    }

    // Clear and switch to doc-update mode
    set({
      llmMessages: [],
      llmTokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      llmCurrentSessionId: null,
      sessionBuffer: { entries: {}, totalChars: 0 },
      llmAborted: false,
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
      llmSessionContext: { mode: "doc-update", projectToken: currentProject.token },
      llmTargetProjectToken: null,
      llmIncludeSourceCode: true,
      llmPanelOpen: true,
    });

    // Send the doc-update prompt with source code enabled, no section context
    get().sendLlmMessage(userMessage, false, undefined, true, "🔄 Updating documentation...");
  },

  startLinkedDocGenSession: (linkedProjectId: string, mode: "generate" | "update" = "generate") => {
    const { currentProject, tree, llmLoading, llmResolveUserInput, linkedProjects } = get();
    if (!currentProject || llmLoading) return;

    // Find the linked project
    const lp = linkedProjects.find(p => p.id === linkedProjectId);
    if (!lp) return;

    if (!lp.project_token) {
      get().addToast("error", "Project has no CCDoc — cannot work with documentation");
      return;
    }

    const projectName = lp.alias || lp.source_path.split(/[\\/]/).pop() || "unnamed";

    let userMessage: string;
    let displayText: string;

    if (mode === "update") {
      // Find the linked node in the tree and build its doc tree summary
      const linkedNode = tree.find(n => n.id === `linked:${linkedProjectId}`);
      const docTree = linkedNode ? buildDocTreeSummary(linkedNode.children) : "(empty)";
      userMessage = buildLinkedDocUpdatePrompt(projectName, lp.source_path, docTree);
      displayText = `🔄 Updating documentation: ${projectName}...`;
    } else {
      userMessage = buildLinkedDocGenPrompt(projectName, lp.source_path);
      displayText = `📝 Generating documentation: ${projectName}...`;
    }

    // Save current session if any
    const { llmMessages } = get();
    if (llmMessages.length > 0) {
      get().saveLlmSession();
    }

    // Resolve pending ask_user promise to prevent dangling await
    if (llmResolveUserInput) {
      llmResolveUserInput("__ABORTED__");
    }

    // Clear and switch to doc-update mode targeting the linked project
    set({
      llmMessages: [],
      llmTokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      llmCurrentSessionId: null,
      sessionBuffer: { entries: {}, totalChars: 0 },
      llmAborted: false,
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
      llmSessionContext: { mode: "doc-update", projectToken: lp.project_token || undefined },
      llmTargetProjectToken: lp.project_token,
      llmIncludeSourceCode: true,
      llmPanelOpen: true,
    });

    // Send with source code enabled
    get().sendLlmMessage(userMessage, false, undefined, true, displayText);
  },

  startDocUpdateQueue: async (projects) => {
    const prepareSession = (targetToken: string | null) => {
      const { llmMessages, llmResolveUserInput } = get();
      if (llmMessages.length > 0) get().saveLlmSession();
      if (llmResolveUserInput) llmResolveUserInput("__ABORTED__");
      set({
        llmMessages: [],
        llmTokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        llmCurrentSessionId: null,
        sessionBuffer: { entries: {}, totalChars: 0 },
        llmAborted: false,
        llmWaitingForUser: false,
        llmPendingQuestion: null,
        llmPendingOptions: null,
        llmResolveUserInput: null,
        llmSessionContext: { mode: "doc-update", projectToken: targetToken || undefined },
        llmTargetProjectToken: targetToken,
        llmIncludeSourceCode: true,
        llmPanelOpen: true,
      });
    };

    for (const proj of projects) {
      const { currentProject, tree, linkedProjects } = get();
      if (!currentProject) break;

      if (proj.type === "main") {
        prepareSession(null);
        const docTree = buildDocTreeSummary(tree);
        const userMessage = buildDocUpdatePrompt(docTree);
        await get().sendLlmMessage(userMessage, false, undefined, true, "🔄 Updating documentation...");
      } else {
        const lp = linkedProjects.find(p => p.id === proj.linkedProjectId);
        if (!lp?.project_token) continue;

        const projectName = lp.alias || lp.source_path.split(/[\\/]/).pop() || "unnamed";
        let userMessage: string;
        let displayText: string;

        if (proj.mode === "update") {
          const linkedNode = tree.find(n => n.id === `linked:${proj.linkedProjectId}`);
          const docTree = linkedNode ? buildDocTreeSummary(linkedNode.children) : "(empty)";
          userMessage = buildLinkedDocUpdatePrompt(projectName, lp.source_path, docTree);
          displayText = `🔄 Updating documentation: ${projectName}...`;
        } else {
          userMessage = buildLinkedDocGenPrompt(projectName, lp.source_path);
          displayText = `📝 Generating documentation: ${projectName}...`;
        }

        prepareSession(lp.project_token);
        await get().sendLlmMessage(userMessage, false, undefined, true, displayText);
      }
    }
  },

  sendLlmMessage: (text, includeContext, attachments, includeSourceCode, displayText, planMode) => {
    return sendLlmMessageImpl(set, get, text, includeContext, attachments, includeSourceCode, displayText, planMode);
  },
});
