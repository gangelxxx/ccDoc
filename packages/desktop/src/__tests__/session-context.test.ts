import { describe, it, expect, vi } from "vitest";
import type { LlmSession, LlmSessionContext, LlmMessage } from "../renderer/stores/types";

// ─── LlmSessionContext type tests ──────────────────────────────

describe("LlmSessionContext type", () => {
  it("supports chat mode (no extra fields)", () => {
    const ctx: LlmSessionContext = { mode: "chat" };
    expect(ctx.mode).toBe("chat");
    expect(ctx.ideaId).toBeUndefined();
    expect(ctx.messageId).toBeUndefined();
    expect(ctx.projectToken).toBeUndefined();
  });

  it("supports plan mode with idea context", () => {
    const ctx: LlmSessionContext = {
      mode: "plan",
      ideaId: "idea-123",
      messageId: "msg-456",
      projectToken: "proj-789",
    };
    expect(ctx.mode).toBe("plan");
    expect(ctx.ideaId).toBe("idea-123");
    expect(ctx.messageId).toBe("msg-456");
    expect(ctx.projectToken).toBe("proj-789");
  });

  it("supports doc-update mode with project token", () => {
    const ctx: LlmSessionContext = {
      mode: "doc-update",
      projectToken: "proj-abc",
    };
    expect(ctx.mode).toBe("doc-update");
    expect(ctx.projectToken).toBe("proj-abc");
  });
});

// ─── LlmSession with context persistence ─────────────────────

describe("LlmSession context persistence", () => {
  function makeSession(overrides?: Partial<LlmSession>): LlmSession {
    return {
      id: "test-session",
      title: "Test",
      messages: [],
      tokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("session without context has context undefined", () => {
    const session = makeSession();
    expect(session.context).toBeUndefined();
  });

  it("session preserves plan context through serialization", () => {
    const ctx: LlmSessionContext = {
      mode: "plan",
      ideaId: "idea-1",
      messageId: "msg-1",
      projectToken: "token-1",
    };
    const session = makeSession({ context: ctx });

    // Simulate serialization (save to vault/JSON)
    const serialized = JSON.stringify(session);
    const restored: LlmSession = JSON.parse(serialized);

    expect(restored.context).toEqual(ctx);
    expect(restored.context?.mode).toBe("plan");
    expect(restored.context?.ideaId).toBe("idea-1");
    expect(restored.context?.messageId).toBe("msg-1");
  });

  it("session preserves doc-update context through serialization", () => {
    const ctx: LlmSessionContext = {
      mode: "doc-update",
      projectToken: "proj-xyz",
    };
    const session = makeSession({ context: ctx });

    const restored: LlmSession = JSON.parse(JSON.stringify(session));
    expect(restored.context).toEqual(ctx);
  });

  it("session without context serializes cleanly (no null pollution)", () => {
    const session = makeSession();
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain('"context"');
  });
});

// ─── Session save/load context flow (unit-level) ──────────────

describe("session context save/load logic", () => {
  // Simulate the save logic from llm-sessions.slice.ts
  function buildSessionFromState(state: {
    messages: LlmMessage[];
    tokensUsed: { input: number; output: number; cacheRead: number; cacheCreation: number };
    sessionContext: LlmSessionContext | null;
    sessionId: string | null;
  }): LlmSession {
    return {
      id: state.sessionId || Date.now().toString(36),
      title: "Test Session",
      messages: state.messages,
      tokensUsed: { ...state.tokensUsed },
      context: state.sessionContext || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // Simulate the load logic from llm-sessions.slice.ts
  function restoreContextFromSession(session: LlmSession): LlmSessionContext | null {
    return session.context || null;
  }

  it("saves plan context to session", () => {
    const ctx: LlmSessionContext = { mode: "plan", ideaId: "idea-1", messageId: "msg-1" };
    const session = buildSessionFromState({
      messages: [{ role: "user", content: "Create plan" } as any],
      tokensUsed: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
      sessionContext: ctx,
      sessionId: "s1",
    });

    expect(session.context).toEqual(ctx);
  });

  it("restores plan context from session", () => {
    const ctx: LlmSessionContext = { mode: "plan", ideaId: "idea-1", messageId: "msg-1" };
    const session = buildSessionFromState({
      messages: [{ role: "user", content: "Create plan" } as any],
      tokensUsed: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
      sessionContext: ctx,
      sessionId: "s1",
    });

    const restored = restoreContextFromSession(session);
    expect(restored).toEqual(ctx);
    expect(restored?.mode).toBe("plan");
    expect(restored?.ideaId).toBe("idea-1");
  });

  it("returns null for session without context", () => {
    const session = buildSessionFromState({
      messages: [{ role: "user", content: "Hello" } as any],
      tokensUsed: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
      sessionContext: null,
      sessionId: "s2",
    });

    const restored = restoreContextFromSession(session);
    expect(restored).toBeNull();
  });

  it("null context results in undefined context field", () => {
    const session = buildSessionFromState({
      messages: [],
      tokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      sessionContext: null,
      sessionId: "s3",
    });

    expect(session.context).toBeUndefined();
    // When serialized and restored, undefined fields are stripped
    const restored: LlmSession = JSON.parse(JSON.stringify(session));
    expect(restored.context).toBeUndefined();
  });
});

// ─── Auto-link planId logic ───────────────────────────────────

describe("auto-link planId by session context", () => {
  interface IdeaMessage {
    id: string;
    text: string;
    planId?: string;
  }

  // Simulate the auto-link logic from tool-executor / llm-engine
  function autoLinkPlan(
    ctx: LlmSessionContext | null,
    createdSectionId: string,
    parentId: string,
    messages: IdeaMessage[],
  ): { linked: boolean; updatedMessages: IdeaMessage[] } {
    if (!ctx || ctx.mode !== "plan" || !ctx.ideaId || !ctx.messageId) {
      return { linked: false, updatedMessages: messages };
    }
    if (parentId !== ctx.ideaId) {
      return { linked: false, updatedMessages: messages };
    }

    const updated = messages.map(m => {
      if (m.id === ctx.messageId && !m.planId) {
        return { ...m, planId: createdSectionId };
      }
      return m;
    });

    const wasLinked = updated.some(m => m.id === ctx.messageId && m.planId === createdSectionId);
    return { linked: wasLinked, updatedMessages: updated };
  }

  it("links planId when context matches", () => {
    const ctx: LlmSessionContext = { mode: "plan", ideaId: "idea-1", messageId: "msg-1" };
    const messages: IdeaMessage[] = [
      { id: "msg-1", text: "Add copy/paste" },
      { id: "msg-2", text: "Fix bug" },
    ];

    const { linked, updatedMessages } = autoLinkPlan(ctx, "plan-section-1", "idea-1", messages);
    expect(linked).toBe(true);
    expect(updatedMessages[0].planId).toBe("plan-section-1");
    expect(updatedMessages[1].planId).toBeUndefined();
  });

  it("does not link if parent_id does not match ideaId", () => {
    const ctx: LlmSessionContext = { mode: "plan", ideaId: "idea-1", messageId: "msg-1" };
    const messages: IdeaMessage[] = [{ id: "msg-1", text: "Test" }];

    const { linked } = autoLinkPlan(ctx, "section-1", "idea-OTHER", messages);
    expect(linked).toBe(false);
  });

  it("does not link if context is null", () => {
    const messages: IdeaMessage[] = [{ id: "msg-1", text: "Test" }];
    const { linked } = autoLinkPlan(null, "section-1", "idea-1", messages);
    expect(linked).toBe(false);
  });

  it("does not link if context mode is chat", () => {
    const ctx: LlmSessionContext = { mode: "chat" };
    const messages: IdeaMessage[] = [{ id: "msg-1", text: "Test" }];
    const { linked } = autoLinkPlan(ctx, "section-1", "idea-1", messages);
    expect(linked).toBe(false);
  });

  it("does not overwrite existing planId", () => {
    const ctx: LlmSessionContext = { mode: "plan", ideaId: "idea-1", messageId: "msg-1" };
    const messages: IdeaMessage[] = [
      { id: "msg-1", text: "Test", planId: "existing-plan" },
    ];

    const { linked, updatedMessages } = autoLinkPlan(ctx, "new-plan", "idea-1", messages);
    expect(linked).toBe(false);
    expect(updatedMessages[0].planId).toBe("existing-plan");
  });

  it("does not link if messageId not found in messages", () => {
    const ctx: LlmSessionContext = { mode: "plan", ideaId: "idea-1", messageId: "msg-nonexistent" };
    const messages: IdeaMessage[] = [{ id: "msg-1", text: "Test" }];

    const { linked } = autoLinkPlan(ctx, "section-1", "idea-1", messages);
    expect(linked).toBe(false);
  });
});

// ─── IdeaChat auto-link orphaned children ─────────────────────

describe("IdeaChat orphaned children auto-link", () => {
  interface Msg { id: string; text: string; createdAt: number; planId?: string; }
  interface TreeChild { id: string; type: string; }

  // Simulate the auto-link logic from IdeaChat useEffect
  function autoLinkOrphans(msgs: Msg[], children: TreeChild[]): { messages: Msg[]; changed: boolean } {
    const linkedIds = new Set(msgs.filter(m => m.planId).map(m => m.planId));
    const orphans = children.filter(c => c.type === "section" && !linkedIds.has(c.id));

    if (orphans.length === 0) return { messages: msgs, changed: false };

    const result = [...msgs];
    const lastMsg = result[result.length - 1];

    for (const orphan of orphans) {
      if (lastMsg && !lastMsg.planId) {
        lastMsg.planId = orphan.id;
      } else {
        result.push({ id: `auto-${orphan.id}`, text: "", createdAt: Date.now(), planId: orphan.id });
      }
    }

    return { messages: result, changed: true };
  }

  it("attaches orphan to last message without planId", () => {
    const msgs: Msg[] = [{ id: "m1", text: "Create plan", createdAt: 1 }];
    const children: TreeChild[] = [{ id: "plan-1", type: "section" }];

    const { messages, changed } = autoLinkOrphans(msgs, children);
    expect(changed).toBe(true);
    expect(messages[0].planId).toBe("plan-1");
  });

  it("creates synthetic message if last message already has planId", () => {
    const msgs: Msg[] = [{ id: "m1", text: "Plan 1", createdAt: 1, planId: "existing" }];
    const children: TreeChild[] = [{ id: "plan-2", type: "section" }];

    const { messages, changed } = autoLinkOrphans(msgs, children);
    expect(changed).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[1].planId).toBe("plan-2");
    expect(messages[1].id).toBe("auto-plan-2");
  });

  it("does nothing if all children are already linked", () => {
    const msgs: Msg[] = [{ id: "m1", text: "Plan", createdAt: 1, planId: "plan-1" }];
    const children: TreeChild[] = [{ id: "plan-1", type: "section" }];

    const { messages, changed } = autoLinkOrphans(msgs, children);
    expect(changed).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it("ignores non-section children", () => {
    const msgs: Msg[] = [{ id: "m1", text: "Test", createdAt: 1 }];
    const children: TreeChild[] = [{ id: "folder-1", type: "folder" }];

    const { messages, changed } = autoLinkOrphans(msgs, children);
    expect(changed).toBe(false);
  });

  it("handles multiple orphans", () => {
    const msgs: Msg[] = [{ id: "m1", text: "Plans", createdAt: 1 }];
    const children: TreeChild[] = [
      { id: "plan-1", type: "section" },
      { id: "plan-2", type: "section" },
    ];

    const { messages, changed } = autoLinkOrphans(msgs, children);
    expect(changed).toBe(true);
    // First orphan goes to last message, second creates synthetic
    expect(messages[0].planId).toBe("plan-1");
    expect(messages[1].planId).toBe("plan-2");
  });

  it("creates synthetic messages when no messages exist", () => {
    const msgs: Msg[] = [];
    const children: TreeChild[] = [{ id: "plan-1", type: "section" }];

    const { messages, changed } = autoLinkOrphans(msgs, children);
    expect(changed).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].planId).toBe("plan-1");
    expect(messages[0].text).toBe("");
  });
});
