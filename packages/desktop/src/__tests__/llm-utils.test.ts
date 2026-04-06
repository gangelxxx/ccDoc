import { describe, it, expect } from "vitest";
import {
  estimateInputTokens,
  truncateToolResult,
  shrinkToolResults,
  formatCompactTree,
  resolveIdInTree,
  computeContextThresholds,
  shouldCompress,
  shouldHardStop,
  isReadOnlyTool,
  isPlanModeTool,
  paginateText,
  CONTEXT_LIMIT,
  COMPRESS_AT,
  HARD_STOP_AT,
  ABSOLUTE_MAX_ROUNDS,
  TOOL_RESULT_LIMIT,
  DEFAULT_CONTENT_LIMIT,
  MAX_CONTENT_LIMIT,
  DEFAULT_MODEL,
  CAPABLE_MODEL,
  READ_ONLY_TOOLS,
  PLAN_TOOLS,
} from "../renderer/llm-utils";
import type { TreeNode } from "../renderer/llm-utils";

// ─── Constants ──────────────────────────────────────────────────

describe("LLM constants", () => {
  it("CONTEXT_LIMIT is 200K (all Claude models)", () => {
    expect(CONTEXT_LIMIT).toBe(200_000);
  });

  it("COMPRESS_AT triggers before HARD_STOP_AT", () => {
    expect(COMPRESS_AT).toBeLessThan(HARD_STOP_AT);
  });

  it("HARD_STOP_AT is under 100%", () => {
    expect(HARD_STOP_AT).toBeLessThan(1.0);
  });

  it("ABSOLUTE_MAX_ROUNDS prevents infinite loops", () => {
    expect(ABSOLUTE_MAX_ROUNDS).toBeGreaterThanOrEqual(10);
    expect(ABSOLUTE_MAX_ROUNDS).toBeLessThanOrEqual(300);
  });

  it("TOOL_RESULT_LIMIT is 6000 chars (~1500 tokens)", () => {
    expect(TOOL_RESULT_LIMIT).toBe(6000);
  });

  it("DEFAULT_MODEL is haiku (cheap)", () => {
    expect(DEFAULT_MODEL).toContain("haiku");
  });

  it("CAPABLE_MODEL is sonnet (mid-tier)", () => {
    expect(CAPABLE_MODEL).toContain("sonnet");
  });
});

// ─── estimateInputTokens ────────────────────────────────────────

describe("estimateInputTokens", () => {
  it("estimates ~2.7 chars per token for plain text", () => {
    const system = "You are a helpful assistant."; // 28 chars
    const messages = [{ role: "user", content: "Hello world" }]; // 11 chars + 20 overhead
    const tokens = estimateInputTokens(system, messages);
    // (28 + 11 + 20) / 2.7 = 21.85 → 22
    expect(tokens).toBe(22);
  });

  it("handles empty system and messages", () => {
    expect(estimateInputTokens("", [])).toBe(0);
  });

  it("handles string content in messages", () => {
    const messages = [
      { role: "user", content: "1234" },   // 4 chars + 20 overhead
      { role: "assistant", content: "5678" }, // 4 chars + 20 overhead
    ];
    // (4+20 + 4+20) / 2.7 = 17.78 → 18
    expect(estimateInputTokens("", messages)).toBe(18);
  });

  it("handles array content with text blocks", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },       // 5 chars
          { type: "text", text: "World" },       // 5 chars
        ],
      },
    ];
    // (5 + 5 + 20) / 2.7 = 11.11 → 11
    expect(estimateInputTokens("", messages)).toBe(11);
  });

  it("handles array content with tool_result blocks", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "result text here!!!" }, // 19 chars
        ],
      },
    ];
    // (19 + 20) / 2.7 = 14.44 → 14
    expect(estimateInputTokens("", messages)).toBe(14);
  });

  it("ignores image blocks (base64 not counted by char length)", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image", source: { data: "base64verylongdata..." } },
          { type: "text", text: "Describe this" }, // 13 chars
        ],
      },
    ];
    // Only text block counted: (13 + 20) / 2.7 = 12.22 → 12
    expect(estimateInputTokens("", messages)).toBe(12);
  });

  it("combines system + all messages", () => {
    const system = "A".repeat(100); // 100 chars
    const messages = [
      { role: "user", content: "B".repeat(200) },     // 200 chars
      { role: "assistant", content: "C".repeat(100) }, // 100 chars
    ];
    // (100 + 200+20 + 100+20) / 2.7 = 162.96 → 163
    expect(estimateInputTokens(system, messages)).toBe(163);
  });

  it("handles tool_result with non-string content (JSON)", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: { key: "value" } },
        ],
      },
    ];
    // Non-string content is ignored, but 20 chars per-message overhead remains
    // 20 / 2.7 = 7.41 → 7
    expect(estimateInputTokens("", messages)).toBe(7);
  });

  it("handles missing text field gracefully", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text" }, // no text field
        ],
      },
    ];
    // 20 chars per-message overhead: 20 / 2.7 = 7.41 → 7
    expect(estimateInputTokens("", messages)).toBe(7);
  });

  it("realistic: typical conversation fits in context", () => {
    const system = "A".repeat(4000); // ~1000 tokens system prompt
    const messages = [
      { role: "user", content: "X".repeat(2000) },     // user message
      { role: "assistant", content: "Y".repeat(8000) }, // assistant response
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "Z".repeat(6000) },
        ],
      },
    ];
    const tokens = estimateInputTokens(system, messages);
    // (4000 + 2000+20 + 8000+20 + 6000+20) / 2.7 = 7430
    expect(tokens).toBe(7430);
    expect(tokens).toBeLessThan(CONTEXT_LIMIT);
  });
});

// ─── truncateToolResult ─────────────────────────────────────────

describe("truncateToolResult", () => {
  it("returns short results unchanged", () => {
    expect(truncateToolResult("short text")).toBe("short text");
  });

  it("returns result at exactly the limit unchanged", () => {
    const exact = "A".repeat(TOOL_RESULT_LIMIT);
    expect(truncateToolResult(exact)).toBe(exact);
  });

  it("truncates results over the limit", () => {
    const long = "A".repeat(TOOL_RESULT_LIMIT + 1000);
    const result = truncateToolResult(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain("[TRUNCATED");
  });

  it("includes original length in truncation message", () => {
    const long = "A".repeat(10000);
    const result = truncateToolResult(long);
    expect(result).toContain("10000 chars total");
  });

  it("preserves the first LIMIT chars before truncation marker", () => {
    const content = "PREFIX_" + "X".repeat(10000);
    const result = truncateToolResult(content);
    expect(result.startsWith("PREFIX_")).toBe(true);
  });

  it("works with custom limit", () => {
    const result = truncateToolResult("A".repeat(200), 100);
    expect(result).toContain("[TRUNCATED");
    expect(result.startsWith("A".repeat(100))).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncateToolResult("")).toBe("");
  });
});

// ─── shrinkToolResults ──────────────────────────────────────────

describe("shrinkToolResults", () => {
  it("leaves short tool results unchanged", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "short" },
        ],
      },
    ];
    const result = shrinkToolResults(msgs, 100);
    expect(result[0].content[0].content).toBe("short");
  });

  it("shrinks long tool results to maxLen + marker", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "A".repeat(500) },
        ],
      },
    ];
    const result = shrinkToolResults(msgs, 100);
    expect(result[0].content[0].content).toHaveLength(100 + "...[compressed]".length);
    expect(result[0].content[0].content).toContain("...[compressed]");
  });

  it("does not modify non-user messages", () => {
    const msgs = [
      { role: "assistant", content: "long assistant response" },
    ];
    const result = shrinkToolResults(msgs, 10);
    expect(result[0]).toEqual(msgs[0]);
  });

  it("does not modify non-tool_result blocks", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "A".repeat(500) },
        ],
      },
    ];
    const result = shrinkToolResults(msgs, 10);
    expect(result[0].content[0].text).toBe("A".repeat(500));
  });

  it("handles mixed blocks — only shrinks tool_result", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "keep this" },
          { type: "tool_result", tool_use_id: "t1", content: "A".repeat(500) },
          { type: "tool_result", tool_use_id: "t2", content: "short" },
        ],
      },
    ];
    const result = shrinkToolResults(msgs, 50);
    expect(result[0].content[0].text).toBe("keep this"); // untouched
    expect(result[0].content[1].content).toContain("...[compressed]"); // shrunk
    expect(result[0].content[2].content).toBe("short"); // short, untouched
  });

  it("handles tool_result with object content (stringifies)", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: { key: "A".repeat(500) } },
        ],
      },
    ];
    const result = shrinkToolResults(msgs, 50);
    expect(result[0].content[0].content).toContain("...[compressed]");
  });

  it("preserves immutability — does not mutate original", () => {
    const original = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "A".repeat(500) },
        ],
      },
    ];
    const originalContent = original[0].content[0].content;
    shrinkToolResults(original, 50);
    expect(original[0].content[0].content).toBe(originalContent); // unchanged
  });

  it("handles empty messages array", () => {
    expect(shrinkToolResults([], 100)).toEqual([]);
  });
});

// ─── formatCompactTree ──────────────────────────────────────────

describe("formatCompactTree", () => {
  it("formats a flat list of nodes", () => {
    const nodes: TreeNode[] = [
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", title: "Docs", type: "folder", children: [] },
      { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", title: "Ideas", type: "folder", children: [] },
    ];
    const result = formatCompactTree(nodes);
    expect(result).toBe("📁 Docs [a1b2c3d4]\n📁 Ideas [b2c3d4e5]");
  });

  it("renders nested children with indentation", () => {
    const nodes: TreeNode[] = [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000000", title: "Root", type: "folder",
        children: [
          {
            id: "bbbbbbbb-0000-0000-0000-000000000000", title: "Doc", type: "file",
            children: [
              { id: "cccccccc-0000-0000-0000-000000000000", title: "Section 1", type: "section", children: [] },
            ],
          },
        ],
      },
    ];
    const result = formatCompactTree(nodes);
    const lines = result.split("\n");
    expect(lines[0]).toBe("📁 Root [aaaaaaaa]");
    expect(lines[1]).toBe("  📄 Doc [bbbbbbbb]");
    expect(lines[2]).toBe("    § Section 1 [cccccccc]");
  });

  it("uses correct type icons", () => {
    const types = ["folder", "file", "section", "idea", "todo", "kanban", "drawing"];
    const expected = ["📁", "📄", "§", "💡", "✅", "📋", "🎨"];
    for (let i = 0; i < types.length; i++) {
      const nodes: TreeNode[] = [{ id: "12345678-0000-0000-0000-000000000000", title: "Test", type: types[i], children: [] }];
      expect(formatCompactTree(nodes)).toContain(expected[i]);
    }
  });

  it("uses custom icon when set", () => {
    const nodes: TreeNode[] = [
      { id: "12345678-0000-0000-0000-000000000000", title: "Custom", type: "folder", icon: "🚀", children: [] },
    ];
    const result = formatCompactTree(nodes);
    expect(result).toContain("🚀 Custom");
    expect(result).not.toContain("📁"); // overridden
  });

  it("uses bullet for unknown type", () => {
    const nodes: TreeNode[] = [
      { id: "12345678-0000-0000-0000-000000000000", title: "Unknown", type: "something_else", children: [] },
    ];
    expect(formatCompactTree(nodes)).toContain("• Unknown");
  });

  it("truncates ID to 8 chars", () => {
    const nodes: TreeNode[] = [
      { id: "abcdefgh-ijkl-mnop-qrst-uvwxyz123456", title: "Test", type: "file", children: [] },
    ];
    const result = formatCompactTree(nodes);
    expect(result).toContain("[abcdefgh]");
    expect(result).not.toContain("ijkl");
  });

  it("handles empty tree", () => {
    expect(formatCompactTree([])).toBe("");
  });

  it("handles deeply nested tree (5+ levels)", () => {
    let node: TreeNode = { id: "e0000000", title: "L5", type: "section", children: [] };
    for (let i = 4; i >= 0; i--) {
      node = { id: `${String.fromCharCode(97 + i)}0000000`, title: `L${i}`, type: i === 0 ? "folder" : "section", children: [node] };
    }
    const result = formatCompactTree([node]);
    const lines = result.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[5]).toMatch(/^\s{10}§ L5/); // 5 levels * 2 spaces = 10
  });
});

// ─── resolveIdInTree ────────────────────────────────────────────

describe("resolveIdInTree", () => {
  const tree: TreeNode[] = [
    {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", title: "Root", type: "folder",
      children: [
        { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", title: "Child", type: "file", children: [] },
        {
          id: "c3d4e5f6-a7b8-9012-cdef-123456789012", title: "Nested", type: "folder",
          children: [
            { id: "d4e5f6a7-b8c9-0123-defa-234567890123", title: "Deep", type: "section", children: [] },
          ],
        },
      ],
    },
  ];

  it("resolves 8-char prefix to full UUID", () => {
    expect(resolveIdInTree("a1b2c3d4", tree)).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("resolves nested node prefix", () => {
    expect(resolveIdInTree("d4e5f6a7", tree)).toBe("d4e5f6a7-b8c9-0123-defa-234567890123");
  });

  it("returns prefix unchanged if not found", () => {
    expect(resolveIdInTree("zzzzzzzz", tree)).toBe("zzzzzzzz");
  });

  it("returns full UUID unchanged (length > 20)", () => {
    const fullId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(resolveIdInTree(fullId, tree)).toBe(fullId);
  });

  it("returns empty string unchanged", () => {
    expect(resolveIdInTree("", tree)).toBe("");
  });

  it("handles empty tree", () => {
    expect(resolveIdInTree("a1b2c3d4", [])).toBe("a1b2c3d4");
  });

  it("resolves partial prefixes (not just 8 chars)", () => {
    expect(resolveIdInTree("b2c3d4", tree)).toBe("b2c3d4e5-f6a7-8901-bcde-f12345678901");
  });
});

// ─── Context management ────────────────────────────────────────

describe("computeContextThresholds", () => {
  it("compressThreshold is 60% of CONTEXT_LIMIT", () => {
    const { compressThreshold } = computeContextThresholds();
    expect(compressThreshold).toBe(120_000);
  });

  it("hardLimit is 85% of CONTEXT_LIMIT", () => {
    const { hardLimit } = computeContextThresholds();
    expect(hardLimit).toBe(170_000);
  });

  it("compressThreshold < hardLimit", () => {
    const { compressThreshold, hardLimit } = computeContextThresholds();
    expect(compressThreshold).toBeLessThan(hardLimit);
  });
});

describe("shouldCompress", () => {
  it("returns false below threshold", () => {
    expect(shouldCompress(100_000)).toBe(false);
  });

  it("returns false at exactly threshold", () => {
    expect(shouldCompress(120_000)).toBe(false);
  });

  it("returns true above threshold", () => {
    expect(shouldCompress(120_001)).toBe(true);
  });
});

describe("shouldHardStop", () => {
  it("returns false below limit", () => {
    expect(shouldHardStop(150_000)).toBe(false);
  });

  it("returns false at exactly limit", () => {
    expect(shouldHardStop(170_000)).toBe(false);
  });

  it("returns true above limit", () => {
    expect(shouldHardStop(170_001)).toBe(true);
  });
});

// ─── Tool classification ───────────────────────────────────────

describe("Tool sets", () => {
  describe("READ_ONLY_TOOLS", () => {
    it("contains all doc read tools", () => {
      for (const t of ["gt", "read", "search"]) {
        expect(READ_ONLY_TOOLS.has(t)).toBe(true);
      }
    });

    it("contains all source code tools", () => {
      for (const t of ["get_project_tree", "get_file_outlines", "read_project_file", "search_project_files", "find_symbols"]) {
        expect(READ_ONLY_TOOLS.has(t)).toBe(true);
      }
    });

    it("contains history tools", () => {
      expect(READ_ONLY_TOOLS.has("get_history")).toBe(true);
      expect(READ_ONLY_TOOLS.has("list_backups")).toBe(true);
    });

    it("does NOT contain write tools", () => {
      for (const t of ["create_section", "update_section", "delete_section", "move_section"]) {
        expect(READ_ONLY_TOOLS.has(t)).toBe(false);
      }
    });

    it("does NOT contain delegate tools", () => {
      for (const t of ["delegate_research", "delegate_writing", "delegate_review", "delegate_planning"]) {
        expect(READ_ONLY_TOOLS.has(t)).toBe(false);
      }
    });
  });

  describe("PLAN_TOOLS", () => {
    it("contains all read tools needed for planning", () => {
      for (const t of ["gt", "read", "search", "get_project_tree", "find_symbols"]) {
        expect(PLAN_TOOLS.has(t)).toBe(true);
      }
    });

    it("contains create_section (the ONLY write tool for plans)", () => {
      expect(PLAN_TOOLS.has("create_section")).toBe(true);
    });

    it("does NOT contain other write tools", () => {
      for (const t of ["update_section", "delete_section", "move_section", "update_icon"]) {
        expect(PLAN_TOOLS.has(t)).toBe(false);
      }
    });

  });
});

describe("isReadOnlyTool", () => {
  it("returns true for read tools", () => {
    expect(isReadOnlyTool("gt")).toBe(true);
    expect(isReadOnlyTool("read")).toBe(true);
    expect(isReadOnlyTool("search")).toBe(true);
    expect(isReadOnlyTool("find_symbols")).toBe(true);
  });

  it("returns false for write tools", () => {
    expect(isReadOnlyTool("create_section")).toBe(false);
    expect(isReadOnlyTool("delete_section")).toBe(false);
  });

  it("returns false for unknown tools", () => {
    expect(isReadOnlyTool("nonexistent_tool")).toBe(false);
  });
});

describe("isPlanModeTool", () => {
  it("allows read + create_section only", () => {
    expect(isPlanModeTool("gt")).toBe(true);
    expect(isPlanModeTool("read")).toBe(true);
    expect(isPlanModeTool("create_section")).toBe(true);
    expect(isPlanModeTool("update_section")).toBe(false);
    expect(isPlanModeTool("delete_section")).toBe(false);
  });
});

// ─── Parallel vs sequential execution logic ─────────────────────

describe("Tool execution order invariants", () => {
  it("read-only tools CAN run in parallel (all independent)", () => {
    const readTools = ["gt", "read", "search", "get_project_tree", "find_symbols"];
    for (const t of readTools) {
      expect(isReadOnlyTool(t)).toBe(true);
    }
  });

  it("mutating tools are NOT read-only", () => {
    const writeTools = ["create_section", "update_section", "delete_section", "move_section"];
    for (const t of writeTools) {
      expect(isReadOnlyTool(t)).toBe(false);
    }
  });
});

// ─── Token budget integration tests ────────────────────────────

describe("Token budget", () => {
  it("typical system prompt + 10 tool results fits in context", () => {
    const systemPrompt = "A".repeat(4000); // ~1000 tokens
    const toolResults: any[] = [];
    for (let i = 0; i < 10; i++) {
      toolResults.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "B".repeat(TOOL_RESULT_LIMIT) }],
      });
    }
    const tokens = estimateInputTokens(systemPrompt, toolResults);
    // (4000 + 10 * (6000 + 20)) / 2.7 = 23778
    expect(tokens).toBe(23778);
    expect(tokens).toBeLessThan(CONTEXT_LIMIT);
  });

  it("maxes out context at ~33 full tool results", () => {
    // Each tool result: TOOL_RESULT_LIMIT = 6000 chars = ~1500 tokens
    // 200K tokens / 1500 = ~133 results
    // But messages have overhead, and system prompt takes space
    // Practical: how many tool results fill context?
    const systemPrompt = "A".repeat(8000); // ~2000 tokens system
    const results = Array.from({ length: 133 }, (_, i) => ({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "X".repeat(TOOL_RESULT_LIMIT) }],
    }));
    const tokens = estimateInputTokens(systemPrompt, results);
    // 8000 + 133 * 6000 = 806000 chars / 4 = 201500 tokens — over limit
    expect(tokens).toBeGreaterThan(CONTEXT_LIMIT);
    // Should trigger compression well before this
    expect(shouldCompress(tokens)).toBe(true);
    expect(shouldHardStop(tokens)).toBe(true);
  });

  it("compression triggers after ~80 full tool results", () => {
    const systemPrompt = "A".repeat(8000);
    const results = Array.from({ length: 80 }, (_, i) => ({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "X".repeat(TOOL_RESULT_LIMIT) }],
    }));
    const tokens = estimateInputTokens(systemPrompt, results);
    // 8000 + 80 * 6000 = 488000 chars / 4 = 122000 tokens > 120K threshold
    expect(shouldCompress(tokens)).toBe(true);
  });

  it("truncation keeps each tool result under budget", () => {
    const oversized = "A".repeat(20000); // 5000 tokens raw
    const truncated = truncateToolResult(oversized);
    const tokens = Math.ceil(truncated.length / 4);
    // Should be close to TOOL_RESULT_LIMIT / 4 = 1500 tokens + truncation message
    expect(tokens).toBeLessThan(2000);
  });

  it("shrinkToolResults aggressively reduces context size", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "X".repeat(TOOL_RESULT_LIMIT) }],
    }));
    const beforeTokens = estimateInputTokens("", messages);
    const shrunk = shrinkToolResults(messages, 500);
    const afterTokens = estimateInputTokens("", shrunk);
    // 20 * 6000 = 120K chars → 20 * 500 = 10K chars — 12x reduction
    expect(beforeTokens / afterTokens).toBeGreaterThan(10);
  });
});

// ─── formatCompactTree token efficiency ────────────────────────

describe("formatCompactTree token efficiency", () => {
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  it("100-node tree is under 800 tokens", () => {
    const nodes: TreeNode[] = [];
    for (let i = 0; i < 10; i++) {
      const children: TreeNode[] = [];
      for (let j = 0; j < 10; j++) {
        children.push({ id: `child${i}${j}0`, title: `Item ${j}`, type: "section", children: [] });
      }
      nodes.push({ id: `folder${i}000`, title: `Folder ${i}`, type: "folder", children });
    }
    const output = formatCompactTree(nodes);
    expect(estimateTokens(output)).toBeLessThan(800);
  });

  it("tree output is deterministic (cache-friendly)", () => {
    const nodes: TreeNode[] = [
      { id: "a0000000", title: "Root", type: "folder", children: [
        { id: "b0000000", title: "Child", type: "file", children: [] },
      ]},
    ];
    expect(formatCompactTree(nodes)).toBe(formatCompactTree(nodes));
  });

  it("maxDepth: 0 shows only root items with children count", () => {
    const nodes: TreeNode[] = [{
      id: "a0000000-0000-0000-0000-000000000000", title: "Root", type: "folder",
      children: [{ id: "b0000000-0000-0000-0000-000000000000", title: "Child", type: "file", children: [] }],
    }];
    const result = formatCompactTree(nodes, 0, true, 0);
    expect(result).toContain("Root");
    expect(result).toContain("(1 child)");
    expect(result).not.toContain("Child");
  });

  it("maxDepth: 1 shows root + direct children, grandchildren hidden with count", () => {
    const nodes: TreeNode[] = [{
      id: "a0000000-0000-0000-0000-000000000000", title: "Root", type: "folder",
      children: [{
        id: "b0000000-0000-0000-0000-000000000000", title: "Child", type: "file",
        children: [{ id: "c0000000-0000-0000-0000-000000000000", title: "GrandChild", type: "section", children: [] }],
      }],
    }];
    const result = formatCompactTree(nodes, 0, true, 1);
    expect(result).toContain("Child");
    expect(result).toContain("(1 child)");
    expect(result).not.toContain("GrandChild");
  });

  it("maxDepth undefined shows all levels (backward compat)", () => {
    const nodes: TreeNode[] = [{
      id: "a0000000-0000-0000-0000-000000000000", title: "Root", type: "folder",
      children: [{
        id: "b0000000-0000-0000-0000-000000000000", title: "Child", type: "file",
        children: [{ id: "c0000000-0000-0000-0000-000000000000", title: "GrandChild", type: "section", children: [] }],
      }],
    }];
    const result = formatCompactTree(nodes, 0, true, undefined);
    expect(result).toContain("GrandChild");
    expect(result).not.toContain("children)");
  });

  it("maxDepth on leaf node — no '(0 children)' suffix", () => {
    const nodes: TreeNode[] = [
      { id: "a0000000-0000-0000-0000-000000000000", title: "Leaf", type: "file", children: [] },
    ];
    const result = formatCompactTree(nodes, 0, true, 0);
    expect(result).not.toContain("children)");
  });
});

// ─── paginateText ───────────────────────────────────────────────

describe("paginateText", () => {
  it("returns full text when under limit", () => {
    const r = paginateText("short text", 0, 6000);
    expect(r.slice).toBe("short text");
    expect(r.hasMore).toBe(false);
    expect(r.offset).toBe(0);
    expect(r.end).toBe(10);
  });

  it("paginates large text — full content, no gaps, no overlaps", () => {
    const para = "A".repeat(5000);
    const text = [para, para, para].join("\n\n");
    const slices: string[] = [];
    let offset = 0;
    let iterations = 0;
    while (true) {
      const r = paginateText(text, offset, 6000);
      slices.push(r.slice);
      if (!r.hasMore) {
        expect(r.end).toBe(text.length);
        break;
      }
      offset = r.end;
      iterations++;
      if (iterations > 100) throw new Error("infinite pagination loop");
    }
    expect(slices.join("")).toBe(text);
  });

  it("offset beyond text returns empty with hasMore=false", () => {
    const r = paginateText("hello", 100, 6000);
    expect(r.slice).toBe("");
    expect(r.hasMore).toBe(false);
  });

  it("aligns end to \\n\\n boundary when within 200 chars", () => {
    const text = "A".repeat(100) + "\n\n" + "B".repeat(100);
    const r = paginateText(text, 0, 95);
    // end=95, \n\n at 100, 100-95=5 < 200 → end=100+2=102 (includes \n\n)
    expect(r.end).toBe(102);
    expect(r.slice).toBe("A".repeat(100) + "\n\n");
    expect(r.slice).not.toContain("B");
  });

  it("falls back to \\n when \\n\\n is too far", () => {
    // \n at pos 100, \n\n at pos 601 (too far from end=95)
    const text = "A".repeat(100) + "\n" + "B".repeat(500) + "\n\n" + "C".repeat(100);
    const r = paginateText(text, 0, 95);
    // end=95, \n\n at 601 (506 away > 200), \n at 100 (5 away < 100) → end=100+1=101 (includes \n)
    expect(r.end).toBe(101);
    expect(r.hasMore).toBe(true);
  });

  it("negative offset clamped to 0", () => {
    const r = paginateText("hello", -5, 10);
    expect(r.offset).toBe(0);
    expect(r.slice).toBe("hello");
  });

  it("limit <= 0 clamped to 1", () => {
    const r = paginateText("hello", 0, -1);
    expect(r.slice.length).toBeGreaterThanOrEqual(1);
  });

  it("DEFAULT_CONTENT_LIMIT and MAX_CONTENT_LIMIT are consistent", () => {
    expect(DEFAULT_CONTENT_LIMIT).toBe(6000);
    expect(MAX_CONTENT_LIMIT).toBe(10000);
    expect(DEFAULT_CONTENT_LIMIT).toBeLessThan(MAX_CONTENT_LIMIT);
  });
});
