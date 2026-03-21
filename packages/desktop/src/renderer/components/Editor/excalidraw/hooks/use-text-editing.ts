import { useCallback } from "react";
import type { DrawElement, DrawState } from "../../drawing-engine.js";
import type { TextEditingState } from "../types.js";

interface UseTextEditingParams {
  stateRef: React.RefObject<DrawState>;
  textInputRef: React.RefObject<HTMLTextAreaElement | null>;
  textEditing: TextEditingState | null;
  textEditingRef: React.MutableRefObject<TextEditingState | null>;
  pushHistory: () => void;
  redraw: () => void;
  scheduleSave: () => void;
  setTextEditing: React.Dispatch<React.SetStateAction<TextEditingState | null>>;
}

export function useTextEditing({
  stateRef,
  textInputRef,
  textEditing,
  textEditingRef,
  pushHistory,
  redraw,
  scheduleSave,
  setTextEditing,
}: UseTextEditingParams) {
  const startTextEditing = useCallback(
    (el: DrawElement) => {
      const { scrollX, scrollY, zoom } = stateRef.current!.appState;
      const x1 = Math.min(el.x, el.x + el.width);
      const y1 = Math.min(el.y, el.y + el.height);
      const vx = x1 * zoom + scrollX;
      const vy = y1 * zoom + scrollY;
      setTextEditing({ el, x: vx, y: vy });
      setTimeout(() => {
        textInputRef.current?.focus();
        redraw();
      }, 0);
    },
    [redraw, stateRef, textInputRef, setTextEditing],
  );

  const commitTextEdit = useCallback(() => {
    if (!textEditing) return;
    const textarea = textInputRef.current;
    if (!textarea) {
      setTextEditing(null);
      textEditingRef.current = null;
      redraw();
      return;
    }
    const newText = textarea.value;
    const oldText = textEditing.isBoundText
      ? textEditing.el.boundText || ""
      : textEditing.el.text || "";
    if (newText === oldText) {
      setTextEditing(null);
      textEditingRef.current = null;
      redraw();
      return;
    }
    pushHistory();
    if (textEditing.isBoundText) {
      textEditing.el.boundText = newText || undefined;
    } else {
      textEditing.el.text = newText;
      // Recalculate bounding box using approximate character width
      const fontSize = textEditing.el.fontSize || 20;
      const charW = fontSize * 0.6;
      const lines = newText.split("\n");
      const widths = lines.map((l) => l.length * charW);
      textEditing.el.width = widths.length > 0 ? Math.max(10, ...widths) : 10;
      textEditing.el.height = Math.max(fontSize, lines.length * fontSize * 1.2);
    }
    setTextEditing(null);
    textEditingRef.current = null;
    redraw();
    scheduleSave();
  }, [textEditing, pushHistory, redraw, scheduleSave, textInputRef, textEditingRef, setTextEditing]);

  const startBoundTextEditing = useCallback(
    (el: DrawElement) => {
      const { scrollX, scrollY, zoom } = stateRef.current!.appState;
      let cx: number, cy: number;
      if (
        (el.type === "line" || el.type === "arrow") &&
        el.points &&
        el.points.length >= 2
      ) {
        const pts = el.points;
        // Walk to midpoint along the polyline
        let totalLen = 0;
        const segLens: number[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const dx = pts[i + 1][0] - pts[i][0],
            dy = pts[i + 1][1] - pts[i][1];
          const len = Math.sqrt(dx * dx + dy * dy);
          segLens.push(len);
          totalLen += len;
        }
        let rem = totalLen / 2,
          mx = pts[0][0],
          my = pts[0][1];
        for (let i = 0; i < segLens.length; i++) {
          if (rem <= segLens[i] || i === segLens.length - 1) {
            const t = segLens[i] > 0 ? rem / segLens[i] : 0;
            mx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
            my = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
            break;
          }
          rem -= segLens[i];
        }
        cx = (el.x + mx) * zoom + scrollX;
        cy = (el.y + my - 10) * zoom + scrollY;
      } else {
        cx = (el.x + el.width / 2) * zoom + scrollX;
        cy = (el.y + el.height / 2) * zoom + scrollY;
      }
      setTextEditing({ el, x: cx, y: cy, isBoundText: true });
      setTimeout(() => {
        textInputRef.current?.focus();
        redraw();
      }, 0);
    },
    [redraw, stateRef, textInputRef, setTextEditing],
  );

  return { startTextEditing, commitTextEdit, startBoundTextEditing };
}
