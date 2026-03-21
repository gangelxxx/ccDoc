import type { LlmSession, AppState, SliceCreator } from "../types.js";

export interface LlmSessionsSlice {
  llmSessions: LlmSession[];
  llmCurrentSessionId: string | null;
  saveLlmSession: () => void;
  loadLlmSession: (id: string) => void;
  deleteLlmSession: (id: string) => void;
}

export const createLlmSessionsSlice: SliceCreator<LlmSessionsSlice> = (set, get) => ({
  llmSessions: [] as LlmSession[], // overwritten by boot
  llmCurrentSessionId: null,

  saveLlmSession: () => {
    const { llmMessages, llmTokensUsed, llmCurrentSessionId, llmSessions } = get();
    if (llmMessages.length === 0) return;

    const firstUserMsg = llmMessages.find(m => m.role === "user");
    const titleText = firstUserMsg
      ? (firstUserMsg.displayContent
        || (typeof firstUserMsg.content === "string"
          ? firstUserMsg.content
          : Array.isArray(firstUserMsg.content)
            ? firstUserMsg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
            : ""))
      : "";
    const title = titleText.slice(0, 60) || "Сессия";

    const now = Date.now();
    const id = llmCurrentSessionId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));

    const existingIdx = llmSessions.findIndex(s => s.id === id);
    const session: LlmSession = {
      id,
      title,
      messages: llmMessages,
      tokensUsed: { ...llmTokensUsed },
      createdAt: existingIdx >= 0 ? llmSessions[existingIdx].createdAt : now,
      updatedAt: now,
    };

    let updated: LlmSession[];
    if (existingIdx >= 0) {
      updated = [...llmSessions];
      updated[existingIdx] = session;
    } else {
      updated = [session, ...llmSessions];
    }
    // Keep max 50 sessions
    if (updated.length > 50) {
      updated.sort((a, b) => b.updatedAt - a.updatedAt);
      updated = updated.slice(0, 50);
    }

    set({ llmSessions: updated, llmCurrentSessionId: id });
    window.api.sessionsSave(updated);
  },

  loadLlmSession: (id) => {
    const { llmSessions, llmMessages, llmResolveUserInput, llmLoading } = get();
    // Save current session first if it has messages and is different
    const { llmCurrentSessionId } = get();
    if (llmMessages.length > 0 && llmCurrentSessionId !== id) {
      get().saveLlmSession();
    }
    // Resolve pending ask_user promise to prevent dangling await
    if (llmResolveUserInput) {
      llmResolveUserInput("__ABORTED__");
    }
    const session = llmSessions.find(s => s.id === id);
    if (!session) return;
    set({
      llmMessages: session.messages,
      llmTokensUsed: { ...session.tokensUsed },
      llmCurrentSessionId: id,
      llmLoading: false,
      llmAborted: llmLoading, // signal stale engine to exit
      llmWaitingForUser: false,
      llmPendingQuestion: null,
      llmPendingOptions: null,
      llmResolveUserInput: null,
    });
  },

  deleteLlmSession: (id) => {
    const { llmSessions, llmCurrentSessionId, llmResolveUserInput, llmLoading } = get();
    const updated = llmSessions.filter(s => s.id !== id);
    const patch: Partial<AppState> = { llmSessions: updated };
    if (llmCurrentSessionId === id) {
      // Resolve pending ask_user promise to prevent dangling await
      if (llmResolveUserInput) {
        llmResolveUserInput("__ABORTED__");
      }
      patch.llmCurrentSessionId = null;
      patch.llmMessages = [];
      patch.llmTokensUsed = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      patch.llmLoading = false;
      if (llmLoading) patch.llmAborted = true; // signal stale engine to exit
      patch.llmWaitingForUser = false;
      patch.llmPendingQuestion = null;
      patch.llmPendingOptions = null;
      patch.llmResolveUserInput = null;
    }
    set(patch as any);
    window.api.sessionsSave(updated);
  },
});
