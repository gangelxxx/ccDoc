import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { VaultRepo } from "../db/vault.repo.js";
import { Vault } from "../services/vault.service.js";
import { createTestAppDb } from "./helpers/app-db.js";

let db: Client;
let vault: Vault;

beforeEach(async () => {
  db = await createTestAppDb();
  const repo = new VaultRepo(db);
  vault = new Vault(repo, { maxRevisions: 5 });
});

describe("Vault.set + get", () => {
  it("stores and retrieves typed values", async () => {
    await vault.set({ theme: "dark", count: 42 }, "test");
    expect(await vault.get<string>("theme")).toBe("dark");
    expect(await vault.get<number>("count")).toBe(42);
  });

  it("stores objects and arrays", async () => {
    const config = { model: "claude", effort: "medium", thinking: true };
    const agents = [{ id: "1", name: "Writer" }, { id: "2", name: "Reviewer" }];
    await vault.set({ llmChat: config, agents }, "test");

    expect(await vault.get("llmChat")).toEqual(config);
    expect(await vault.get("agents")).toEqual(agents);
  });

  it("returns null for missing key", async () => {
    expect(await vault.get("missing")).toBeNull();
  });

  it("overwrites previous values", async () => {
    await vault.set({ theme: "dark" }, "test:1");
    await vault.set({ theme: "light" }, "test:2");
    expect(await vault.get("theme")).toBe("light");
  });
});

describe("Vault.getAll", () => {
  it("returns all current values", async () => {
    await vault.set({ theme: "dark", language: "ru" }, "test:1");
    await vault.set({ theme: "light" }, "test:2");

    const all = await vault.getAll();
    expect(all).toEqual({ theme: "light", language: "ru" });
  });

  it("returns empty object when vault is empty", async () => {
    const all = await vault.getAll();
    expect(all).toEqual({});
  });
});

describe("Vault.history", () => {
  it("returns revision history with sources", async () => {
    await vault.set({ a: 1 }, "ui:theme");
    await vault.set({ b: 2 }, "llm:apiKey");

    const history = await vault.history();
    expect(history).toHaveLength(2);
    expect(history[0].source).toBe("llm:apiKey");
    expect(history[1].source).toBe("ui:theme");
  });

  it("tracks which keys changed per revision", async () => {
    await vault.set({ theme: "dark", language: "ru" }, "boot");
    const history = await vault.history();
    expect(history[0].keys.sort()).toEqual(["language", "theme"]);
  });
});

describe("Vault.snapshot", () => {
  it("reconstructs state at a specific revision", async () => {
    const rev1 = await vault.set({ theme: "dark", language: "en" }, "s1");
    const rev2 = await vault.set({ theme: "light" }, "s2");

    const snap1 = await vault.snapshot(rev1);
    expect(snap1).toEqual({ theme: "dark", language: "en" });

    const snap2 = await vault.snapshot(rev2);
    expect(snap2).toEqual({ theme: "light", language: "en" });
  });
});

describe("Vault.rollback", () => {
  it("restores state from a previous revision", async () => {
    const rev1 = await vault.set({ theme: "dark", apiKey: "sk-old" }, "s1");
    await vault.set({ theme: "light", apiKey: "sk-new" }, "s2");

    // Current state
    expect(await vault.get("theme")).toBe("light");
    expect(await vault.get("apiKey")).toBe("sk-new");

    // Rollback to rev1
    await vault.rollback(rev1, "user:rollback");

    // State restored
    expect(await vault.get("theme")).toBe("dark");
    expect(await vault.get("apiKey")).toBe("sk-old");
  });

  it("creates a new revision (not destructive)", async () => {
    await vault.set({ a: 1 }, "s1");
    const rev2 = await vault.set({ a: 2 }, "s2");
    await vault.rollback(rev2, "user:rollback");

    const history = await vault.history();
    // Should have 3 revisions: s1, s2, rollback
    expect(history).toHaveLength(3);
    expect(history[0].source).toBe("user:rollback");
  });
});

describe("Vault auto-prune", () => {
  it("prunes old revisions beyond maxRevisions", async () => {
    // maxRevisions is 5
    for (let i = 0; i < 8; i++) {
      await vault.set({ counter: i }, `s${i}`);
    }

    const history = await vault.history();
    expect(history.length).toBeLessThanOrEqual(5);
  });

  it("preserves latest values after auto-prune", async () => {
    for (let i = 0; i < 8; i++) {
      await vault.set({ counter: i, stable: "keep" }, `s${i}`);
    }

    expect(await vault.get("counter")).toBe(7);
    expect(await vault.get("stable")).toBe("keep");
  });
});

describe("Vault with complex data", () => {
  it("handles nested objects", async () => {
    const embedding = {
      mode: "local",
      localModelId: "multilingual-e5-small",
      onlineProvider: "openai",
      onlineApiKey: "",
    };
    await vault.set({ embedding }, "test");
    expect(await vault.get("embedding")).toEqual(embedding);
  });

  it("handles arrays of objects", async () => {
    const agents = [
      { id: "1", name: "Writer", tools: ["gt", "read", "create_section"] },
      { id: "2", name: "Reviewer", tools: ["gt", "read"] },
    ];
    await vault.set({ customAgents: agents }, "agents:set");
    expect(await vault.get("customAgents")).toEqual(agents);
  });

  it("handles empty string values", async () => {
    await vault.set({ apiKey: "" }, "test");
    expect(await vault.get("apiKey")).toBe("");
  });

  it("handles boolean and null values", async () => {
    await vault.set({ flag: true, nothing: null }, "test");
    expect(await vault.get("flag")).toBe(true);
    expect(await vault.get("nothing")).toBeNull();
  });
});
