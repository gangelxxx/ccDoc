import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { VaultRepo } from "../db/vault.repo.js";
import { createTestAppDb } from "./helpers/app-db.js";

let db: Client;
let vault: VaultRepo;

beforeEach(async () => {
  db = await createTestAppDb();
  vault = new VaultRepo(db);
});

describe("VaultRepo.commit + getLatest", () => {
  it("stores and retrieves a single key", async () => {
    await vault.commit({ theme: '"dark"' }, "test");
    const val = await vault.getLatest("theme");
    expect(val).toBe('"dark"');
  });

  it("returns null for missing key", async () => {
    const val = await vault.getLatest("nonexistent");
    expect(val).toBeNull();
  });

  it("returns latest value after multiple commits", async () => {
    await vault.commit({ theme: '"dark"' }, "test:1");
    await vault.commit({ theme: '"light"' }, "test:2");
    const val = await vault.getLatest("theme");
    expect(val).toBe('"light"');
  });

  it("stores multiple keys in one commit", async () => {
    await vault.commit({ theme: '"dark"', language: '"ru"' }, "test");
    expect(await vault.getLatest("theme")).toBe('"dark"');
    expect(await vault.getLatest("language")).toBe('"ru"');
  });

  it("returns revision number from commit", async () => {
    const rev1 = await vault.commit({ a: "1" }, "test");
    const rev2 = await vault.commit({ b: "2" }, "test");
    expect(rev1).toBeGreaterThan(0);
    expect(rev2).toBeGreaterThan(rev1);
  });

  it("returns -1 for empty commit", async () => {
    const rev = await vault.commit({}, "test");
    expect(rev).toBe(-1);
  });
});

describe("VaultRepo.getAllLatest", () => {
  it("returns empty record when vault is empty", async () => {
    const all = await vault.getAllLatest();
    expect(all).toEqual({});
  });

  it("returns latest values across multiple revisions", async () => {
    await vault.commit({ theme: '"dark"', language: '"en"' }, "test:1");
    await vault.commit({ theme: '"light"' }, "test:2");
    await vault.commit({ apiKey: '"sk-123"' }, "test:3");

    const all = await vault.getAllLatest();
    expect(all).toEqual({
      theme: '"light"',
      language: '"en"',
      apiKey: '"sk-123"',
    });
  });
});

describe("VaultRepo.getRevisions", () => {
  it("returns revisions in descending order", async () => {
    await vault.commit({ a: "1" }, "src:first");
    await vault.commit({ b: "2" }, "src:second");
    await vault.commit({ c: "3" }, "src:third");

    const revs = await vault.getRevisions(10);
    expect(revs).toHaveLength(3);
    expect(revs[0].source).toBe("src:third");
    expect(revs[1].source).toBe("src:second");
    expect(revs[2].source).toBe("src:first");
  });

  it("includes changed keys in each revision", async () => {
    await vault.commit({ theme: '"dark"', language: '"ru"' }, "test");
    const revs = await vault.getRevisions(10);
    expect(revs[0].keys.sort()).toEqual(["language", "theme"]);
  });

  it("respects limit", async () => {
    await vault.commit({ a: "1" }, "s1");
    await vault.commit({ b: "2" }, "s2");
    await vault.commit({ c: "3" }, "s3");

    const revs = await vault.getRevisions(2);
    expect(revs).toHaveLength(2);
    expect(revs[0].source).toBe("s3");
    expect(revs[1].source).toBe("s2");
  });

  it("has created_at timestamp", async () => {
    await vault.commit({ a: "1" }, "test");
    const revs = await vault.getRevisions(1);
    expect(revs[0].created_at).toBeTruthy();
  });
});

describe("VaultRepo.getRevision (point-in-time snapshot)", () => {
  it("reconstructs state at a specific revision", async () => {
    const rev1 = await vault.commit({ theme: '"dark"', lang: '"en"' }, "s1");
    const rev2 = await vault.commit({ theme: '"light"' }, "s2");
    await vault.commit({ apiKey: '"sk-new"' }, "s3");

    // At rev1: theme=dark, lang=en
    const snap1 = await vault.getRevision(rev1);
    expect(snap1).toEqual({ theme: '"dark"', lang: '"en"' });

    // At rev2: theme=light (updated), lang=en (inherited)
    const snap2 = await vault.getRevision(rev2);
    expect(snap2).toEqual({ theme: '"light"', lang: '"en"' });
  });

  it("returns empty for revision 0", async () => {
    await vault.commit({ a: "1" }, "test");
    const snap = await vault.getRevision(0);
    expect(snap).toEqual({});
  });
});

describe("VaultRepo.prune", () => {
  it("keeps only the latest N revisions", async () => {
    await vault.commit({ a: "1" }, "s1");
    await vault.commit({ b: "2" }, "s2");
    await vault.commit({ c: "3" }, "s3");
    await vault.commit({ d: "4" }, "s4");
    await vault.commit({ e: "5" }, "s5");

    const deleted = await vault.prune(3);
    expect(deleted).toBe(2); // s1, s2 deleted

    const revs = await vault.getRevisions(10);
    expect(revs).toHaveLength(3);
    expect(revs.map((r) => r.source)).toEqual(["s5", "s4", "s3"]);
  });

  it("does nothing when fewer revisions than keepCount", async () => {
    await vault.commit({ a: "1" }, "s1");
    await vault.commit({ b: "2" }, "s2");

    const deleted = await vault.prune(5);
    expect(deleted).toBe(0);

    const revs = await vault.getRevisions(10);
    expect(revs).toHaveLength(2);
  });

  it("preserves latest values after pruning", async () => {
    await vault.commit({ theme: '"v1"' }, "s1");
    await vault.commit({ theme: '"v2"' }, "s2");
    await vault.commit({ theme: '"v3"' }, "s3");

    await vault.prune(1);
    expect(await vault.getLatest("theme")).toBe('"v3"');
  });
});
