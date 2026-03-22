import { useCallback } from "react";
import type { ToolType, DrawState } from "../../drawing-engine.js";
import { createElement } from "../../drawing-engine.js";

interface UseImageInsertParams {
  stateRef: React.RefObject<DrawState>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  pushHistory: () => void;
  strokeColor: string;
  strokeWidth: number;
  redraw: () => void;
  scheduleSave: () => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveTool: React.Dispatch<React.SetStateAction<ToolType>>;
}

export function useImageInsert({
  stateRef,
  containerRef,
  pushHistory,
  strokeColor,
  strokeWidth,
  redraw,
  scheduleSave,
  setSelectedIds,
  setActiveTool,
}: UseImageInsertParams) {
  const insertImageElement = useCallback(
    (dataUrl: string) => {
      pushHistory();
      const { scrollX, scrollY, zoom } = stateRef.current!.appState;
      const container = containerRef.current;
      const cw = container?.clientWidth ?? 800;
      const ch = container?.clientHeight ?? 600;
      // Place at center of viewport
      const cx = (cw / 2 - scrollX) / zoom;
      const cy = (ch / 2 - scrollY) / zoom;
      const size = 200;
      const el = createElement("image", cx - size / 2, cy - size / 2, {
        strokeColor,
        strokeWidth,
        imageData: dataUrl,
      });
      el.width = size;
      el.height = size;
      // Try to load natural dimensions and adjust aspect ratio
      const img = new Image();
      img.onload = () => {
        const maxDim = 300;
        const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
        el.width = img.naturalWidth * scale;
        el.height = img.naturalHeight * scale;
        el.x = cx - el.width / 2;
        el.y = cy - el.height / 2;
        redraw();
        scheduleSave(); // Save correct dimensions after image loads
      };
      img.src = dataUrl;
      stateRef.current!.elements.push(el);
      setSelectedIds(new Set([el.id]));
      setActiveTool("selection");
      redraw();
      scheduleSave();
    },
    [pushHistory, strokeColor, strokeWidth, redraw, scheduleSave, stateRef, containerRef, setSelectedIds, setActiveTool],
  );

  const pickAndInsertImage = useCallback(async () => {
    try {
      const dataUrl = await window.api.pickImage();
      if (dataUrl) insertImageElement(dataUrl);
    } catch (err) {
      console.warn("[DrawingCanvas] pickImage failed:", err);
    }
  }, [insertImageElement]);

  return { insertImageElement, pickAndInsertImage };
}
