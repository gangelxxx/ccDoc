import { useEffect } from "react";
import type { ToolType } from "../drawing-engine.js";

interface UseKeyboardParams {
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  copySelected: () => void;
  paste: () => void;
  duplicate: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  insertImageElement: (dataUrl: string) => void;
  pickAndInsertImage: () => void;
  setActiveTool: (tool: ToolType) => void;
  setSelectedIds: (ids: Set<string>) => void;
  redraw: () => void;
}

export function useKeyboard({
  deleteSelected,
  undo,
  redo,
  copySelected,
  paste,
  duplicate,
  bringToFront,
  sendToBack,
  insertImageElement,
  pickAndInsertImage,
  setActiveTool,
  setSelectedIds,
  redraw,
}: UseKeyboardParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Delete" || e.key === "Backspace") { deleteSelected(); e.preventDefault(); }
      else if (e.key === "z" && ctrl && !e.shiftKey) { undo(); e.preventDefault(); }
      else if ((e.key === "z" && ctrl && e.shiftKey) || (e.key === "y" && ctrl)) { redo(); e.preventDefault(); }
      else if (e.key === "c" && ctrl) { copySelected(); e.preventDefault(); }
      else if (e.key === "v" && ctrl) {
        e.preventDefault();
        // Try clipboard image first, fall back to internal paste
        (async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const imgType = item.types.find((t) => t.startsWith("image/"));
              if (imgType) {
                const blob = await item.getType(imgType);
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === "string") insertImageElement(reader.result);
                };
                reader.readAsDataURL(blob);
                return;
              }
            }
          } catch { /* clipboard API unavailable or no image */ }
          paste();
        })();
      }
      else if (e.key === "d" && ctrl) { duplicate(); e.preventDefault(); }
      else if (e.key === "x" && ctrl) { copySelected(); deleteSelected(); e.preventDefault(); }
      else if (e.key === "]" && ctrl) { bringToFront(); e.preventDefault(); }
      else if (e.key === "[" && ctrl) { sendToBack(); e.preventDefault(); }
      else if (e.key === "Escape") { setActiveTool("selection"); setSelectedIds(new Set()); redraw(); }
      else if (!ctrl) {
        const keyMap: Record<string, ToolType> = {
          v: "selection", "1": "selection",
          r: "rectangle", "2": "rectangle",
          o: "ellipse", "3": "ellipse",
          d: "diamond", "4": "diamond",
          l: "line", "5": "line",
          a: "arrow", "6": "arrow",
          p: "freedraw", "7": "freedraw",
          t: "text", "8": "text",
        };
        if (e.key === "i") { pickAndInsertImage(); }
        else if (keyMap[e.key]) setActiveTool(keyMap[e.key]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected, undo, redo, redraw, copySelected, paste, duplicate, bringToFront, sendToBack, insertImageElement, pickAndInsertImage, setActiveTool, setSelectedIds]);
}
