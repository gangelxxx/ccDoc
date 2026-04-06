import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { EmbeddingRepo } from "../db/embedding.repo.js";
import { createTestDb, insertSection } from "./helpers/db.js";

let db: Client;
let repo: EmbeddingRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new EmbeddingRepo(db);
});

function makeEmbedding(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("EmbeddingRepo.upsert", () => {
  it("saves embedding for a section", async () => {
    await insertSection(db, "s1", "Test section");
    const emb = makeEmbedding([0.1, 0.2, 0.3]);

    await repo.upsert("s1", emb, "hash123");

    const hash = await repo.getTextHash("s1");
    expect(hash).toBe("hash123");
    expect(await repo.count()).toBe(1);
  });

  it("repeated upsert updates embedding and hash", async () => {
    await insertSection(db, "s1", "Test section");
    const emb1 = makeEmbedding([0.1, 0.2, 0.3]);
    const emb2 = makeEmbedding([0.4, 0.5, 0.6]);

    await repo.upsert("s1", emb1, "hash_v1");
    await repo.upsert("s1", emb2, "hash_v2");

    expect(await repo.count()).toBe(1);
    const hash = await repo.getTextHash("s1");
    expect(hash).toBe("hash_v2");
  });
});

describe("EmbeddingRepo.getTextHash", () => {
  it("returns hash for an existing entry", async () => {
    await insertSection(db, "s1", "Test");
    await repo.upsert("s1", makeEmbedding([1, 0]), "abc123");

    const hash = await repo.getTextHash("s1");
    expect(hash).toBe("abc123");
  });

  it("returns null for a nonexistent section", async () => {
    const hash = await repo.getTextHash("nonexistent");
    expect(hash).toBeNull();
  });
});

describe("EmbeddingRepo.getAll", () => {
  it("returns all embeddings for non-deleted sections", async () => {
    await insertSection(db, "s1", "Section 1");
    await insertSection(db, "s2", "Section 2");
    await repo.upsert("s1", makeEmbedding([1, 0]), "h1");
    await repo.upsert("s2", makeEmbedding([0, 1]), "h2");

    const all = await repo.getAll();
    expect(all).toHaveLength(2);
    const ids = all.map((r) => r.section_id).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("excludes deleted sections", async () => {
    await insertSection(db, "s-active", "Active");
    await insertSection(db, "s-deleted", "Deleted");
    await repo.upsert("s-active", makeEmbedding([1, 0]), "h1");
    await repo.upsert("s-deleted", makeEmbedding([0, 1]), "h2");

    await db.execute({
      sql: "UPDATE sections SET deleted_at = datetime('now') WHERE id = ?",
      args: ["s-deleted"],
    });

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].section_id).toBe("s-active");
  });

  it("correctly restores Float32Array from BLOB", async () => {
    await insertSection(db, "s1", "Section");
    const original = makeEmbedding([0.123, -0.456, 0.789, 1.0]);
    await repo.upsert("s1", original, "h1");

    const all = await repo.getAll();
    expect(all).toHaveLength(1);

    const restored = all[0].embedding;
    expect(restored).toBeInstanceOf(Float32Array);
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5);
    }
  });
});

describe("EmbeddingRepo.delete", () => {
  it("deletes entry by section_id", async () => {
    await insertSection(db, "s1", "Section");
    await repo.upsert("s1", makeEmbedding([1, 0]), "h1");

    await repo.delete("s1");

    expect(await repo.count()).toBe(0);
    expect(await repo.getTextHash("s1")).toBeNull();
  });
});

describe("EmbeddingRepo.deleteAll", () => {
  it("clears all entries", async () => {
    await insertSection(db, "s1", "A");
    await insertSection(db, "s2", "B");
    await repo.upsert("s1", makeEmbedding([1, 0]), "h1");
    await repo.upsert("s2", makeEmbedding([0, 1]), "h2");

    await repo.deleteAll();

    expect(await repo.count()).toBe(0);
  });
});

describe("EmbeddingRepo.count", () => {
  it("counts only entries with non-NULL embedding", async () => {
    expect(await repo.count()).toBe(0);

    await insertSection(db, "s1", "A");
    await repo.upsert("s1", makeEmbedding([1, 0, 0]), "h1");

    expect(await repo.count()).toBe(1);

    await insertSection(db, "s2", "B");
    await repo.upsert("s2", makeEmbedding([0, 1, 0]), "h2");

    expect(await repo.count()).toBe(2);
  });
});
