import { describe, it, expect } from "vitest";
import { cosineSimilarity, textHash } from "../services/embedding.service.js";

describe("cosineSimilarity", () => {
  it("identical normalized vectors → 1.0", () => {
    const v = new Float32Array([0.6, 0.8]); // norm = 1.0
    const sim = cosineSimilarity(v, v);
    expect(sim).toBeCloseTo(1.0, 5);
  });

  it("orthogonal vectors → 0.0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeCloseTo(0.0, 5);
  });

  it("opposite normalized vectors → -1.0", () => {
    const a = new Float32Array([0.6, 0.8]);
    const b = new Float32Array([-0.6, -0.8]);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeCloseTo(-1.0, 5);
  });

  it("different but close normalized vectors → 0 < s < 1", () => {
    const a = new Float32Array([0.6, 0.8]);
    const b = new Float32Array([0.7071, 0.7071]); // ~45°
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("empty vectors → 0", () => {
    const a = new Float32Array([]);
    const b = new Float32Array([]);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBe(0);
  });
});

describe("textHash", () => {
  it("same text → same hash", () => {
    const h1 = textHash("hello world");
    const h2 = textHash("hello world");
    expect(h1).toBe(h2);
  });

  it("different text → different hash", () => {
    const h1 = textHash("hello");
    const h2 = textHash("world");
    expect(h1).not.toBe(h2);
  });

  it("hash length is 16 characters", () => {
    const h = textHash("test string");
    expect(h).toHaveLength(16);
  });

  it("hash contains only hex characters", () => {
    const h = textHash("some text for hashing");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
