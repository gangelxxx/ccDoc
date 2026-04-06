import { describe, it, expect } from "vitest";
import {
  getEditorContextMenuItems,
  type EditorMenuItem,
  type EditorMenuEntry,
} from "../renderer/components/Editor/editor-context-menu";

// Simple pass-through translator — returns the key as-is.
const t = (key: string) => key;

// Helper: filter out separators
function items(entries: EditorMenuEntry[]): EditorMenuItem[] {
  return entries.filter((e): e is EditorMenuItem => e !== "sep");
}

// Helper: find item by id
function findItem(entries: EditorMenuEntry[], id: string): EditorMenuItem | undefined {
  return items(entries).find((i) => i.id === id);
}

// ─── Structure ───

describe("getEditorContextMenuItems — structure", () => {
  const result = getEditorContextMenuItems(true, true, t);

  it("returns 7 entries (5 items + 2 separators)", () => {
    expect(result).toHaveLength(7);
  });

  it("has 5 menu items", () => {
    expect(items(result)).toHaveLength(5);
  });

  it("contains cut, copy, paste, selectAll, pasteMarkdown items", () => {
    const ids = items(result).map((i) => i.id);
    expect(ids).toEqual(["cut", "copy", "paste", "selectAll", "pasteMarkdown"]);
  });

  it("has separators in correct positions", () => {
    // After paste (index 3) and after selectAll (index 5)
    expect(result[3]).toBe("sep");
    expect(result[5]).toBe("sep");
  });

  it("item order: cut, copy, paste, sep, selectAll, sep, pasteMarkdown", () => {
    const order = result.map((e) => (e === "sep" ? "sep" : e.id));
    expect(order).toEqual([
      "cut", "copy", "paste", "sep", "selectAll", "sep", "pasteMarkdown",
    ]);
  });
});

// ─── Shortcuts ───

describe("getEditorContextMenuItems — shortcuts", () => {
  const result = getEditorContextMenuItems(true, true, t);

  it("cut has Ctrl+X", () => {
    expect(findItem(result, "cut")?.shortcut).toBe("Ctrl+X");
  });

  it("copy has Ctrl+C", () => {
    expect(findItem(result, "copy")?.shortcut).toBe("Ctrl+C");
  });

  it("paste has Ctrl+V", () => {
    expect(findItem(result, "paste")?.shortcut).toBe("Ctrl+V");
  });

  it("selectAll has Ctrl+A", () => {
    expect(findItem(result, "selectAll")?.shortcut).toBe("Ctrl+A");
  });

  it("pasteMarkdown has no shortcut", () => {
    expect(findItem(result, "pasteMarkdown")?.shortcut).toBeUndefined();
  });
});

// ─── Labels (translation keys) ───

describe("getEditorContextMenuItems — labels", () => {
  const result = getEditorContextMenuItems(false, false, t);

  it("cut label uses editorCut key", () => {
    expect(findItem(result, "cut")?.label).toBe("editorCut");
  });

  it("copy label uses editorCopy key", () => {
    expect(findItem(result, "copy")?.label).toBe("editorCopy");
  });

  it("paste label uses editorPaste key", () => {
    expect(findItem(result, "paste")?.label).toBe("editorPaste");
  });

  it("selectAll label uses editorSelectAll key", () => {
    expect(findItem(result, "selectAll")?.label).toBe("editorSelectAll");
  });

  it("pasteMarkdown label uses pasteMarkdown key", () => {
    expect(findItem(result, "pasteMarkdown")?.label).toBe("pasteMarkdown");
  });

  it("passes keys through t() function", () => {
    const labels: string[] = [];
    const mockT = (key: string) => { labels.push(key); return `[${key}]`; };
    const result2 = getEditorContextMenuItems(true, true, mockT);
    expect(labels).toEqual([
      "editorCut", "editorCopy", "editorPaste", "editorSelectAll", "pasteMarkdown",
    ]);
    expect(findItem(result2, "cut")?.label).toBe("[editorCut]");
  });
});

// ─── Icons ───

describe("getEditorContextMenuItems — icons", () => {
  const result = getEditorContextMenuItems(true, true, t);

  it("pasteMarkdown has clipboard icon", () => {
    expect(findItem(result, "pasteMarkdown")?.icon).toBe("📋");
  });

  it("standard items have no icon", () => {
    for (const id of ["cut", "copy", "paste", "selectAll"]) {
      expect(findItem(result, id)?.icon).toBeUndefined();
    }
  });
});

// ─── Disabled states: no selection, no clipboard ───

describe("getEditorContextMenuItems — no selection, no clipboard", () => {
  const result = getEditorContextMenuItems(false, false, t);

  it("cut is disabled", () => {
    expect(findItem(result, "cut")?.disabled).toBe(true);
  });

  it("copy is disabled", () => {
    expect(findItem(result, "copy")?.disabled).toBe(true);
  });

  it("paste is disabled", () => {
    expect(findItem(result, "paste")?.disabled).toBe(true);
  });

  it("selectAll is not disabled", () => {
    expect(findItem(result, "selectAll")?.disabled).toBeFalsy();
  });

  it("pasteMarkdown is not disabled", () => {
    expect(findItem(result, "pasteMarkdown")?.disabled).toBeFalsy();
  });
});

// ─── Disabled states: with selection, no clipboard ───

describe("getEditorContextMenuItems — with selection, no clipboard", () => {
  const result = getEditorContextMenuItems(true, false, t);

  it("cut is enabled", () => {
    expect(findItem(result, "cut")?.disabled).toBeFalsy();
  });

  it("copy is enabled", () => {
    expect(findItem(result, "copy")?.disabled).toBeFalsy();
  });

  it("paste is still disabled", () => {
    expect(findItem(result, "paste")?.disabled).toBe(true);
  });
});

// ─── Disabled states: no selection, with clipboard ───

describe("getEditorContextMenuItems — no selection, with clipboard", () => {
  const result = getEditorContextMenuItems(false, true, t);

  it("cut is disabled", () => {
    expect(findItem(result, "cut")?.disabled).toBe(true);
  });

  it("copy is disabled", () => {
    expect(findItem(result, "copy")?.disabled).toBe(true);
  });

  it("paste is enabled", () => {
    expect(findItem(result, "paste")?.disabled).toBeFalsy();
  });
});

// ─── Disabled states: with selection AND clipboard (all enabled) ───

describe("getEditorContextMenuItems — with selection and clipboard", () => {
  const result = getEditorContextMenuItems(true, true, t);

  it("cut is enabled", () => {
    expect(findItem(result, "cut")?.disabled).toBeFalsy();
  });

  it("copy is enabled", () => {
    expect(findItem(result, "copy")?.disabled).toBeFalsy();
  });

  it("paste is enabled", () => {
    expect(findItem(result, "paste")?.disabled).toBeFalsy();
  });

  it("selectAll is enabled", () => {
    expect(findItem(result, "selectAll")?.disabled).toBeFalsy();
  });

  it("pasteMarkdown is enabled", () => {
    expect(findItem(result, "pasteMarkdown")?.disabled).toBeFalsy();
  });
});
