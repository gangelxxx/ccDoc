import type { LlmAttachment, LlmMessage, SliceCreator } from "../types.js";
import { sendLlmMessageImpl } from "../llm-engine.js";
import { buildDocTreeSummary, buildDocUpdatePrompt } from "../llm/doc-update-prompt.js";

export interface LlmChatSlice {
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
  llmSessionMode: "chat" | "doc-update";
  setLlmIncludeContext: (v: boolean) => void;
  setLlmIncludeSourceCode: (v: boolean) => void;
  setWaitingForUser: (question: string, options: string[] | null, resolve: (answer: string) => void) => void;
  submitUserAnswer: (answer: string) => void;
  sendLlmMessage: (text: string, includeContext: boolean, attachments?: LlmAttachment[], includeSourceCode?: boolean, displayText?: string, planMode?: boolean) => Promise<string | null>;
  stopLlmChat: () => void;
  retryLlmMessage: (userMsgIndex?: number) => void;
  clearLlmMessages: () => void;
  startDocUpdateSession: () => void;
}

export const createLlmChatSlice: SliceCreator<LlmChatSlice> = (set, get) => ({
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
  llmSessionMode: "chat",
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
    const { llmResolveUserInput, llmMessages } = get();
    if (llmResolveUserInput) {
      llmResolveUserInput("__ABORTED__");
    }
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
    const text = typeof userMsg.content === "string" ? userMsg.content : "";
    // Remove this message and everything after it, then resend
    set({ llmMessages: llmMessages.slice(0, idx) });
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
      llmLoading: false,
      llmAborted: llmLoading, // signal stale engine to exit
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
      llmSessionMode: "chat",
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
      llmAborted: false,
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
      llmSessionMode: "doc-update",
      llmPanelOpen: true,
    });

    // Send the doc-update prompt with source code enabled, no section context
    get().sendLlmMessage(userMessage, false, undefined, true, "🔄 Обновление документации...");
  },

  sendLlmMessage: (text, includeContext, attachments, includeSourceCode, displayText, planMode) => {
    return sendLlmMessageImpl(set, get, text, includeContext, attachments, includeSourceCode, displayText, planMode);
  },
});
