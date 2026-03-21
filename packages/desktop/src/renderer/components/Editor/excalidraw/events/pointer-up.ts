import { useCallback } from "react";
import {
  viewportToScene, getElementsInSelectionBox, updateBindings,
} from "../../drawing-engine.js";
import type { CanvasEventContext } from "./types.js";

export function usePointerUp(ctx: CanvasEventContext) {
  const {
    pointerState, stateRef, bindTargetRef, selectedIds,
    redraw, scheduleSave, setSelectedIds, setActiveTool,
  } = ctx;

  return useCallback((e: React.PointerEvent) => {
    const ps = pointerState.current!;
    ps.isDown = false;

    if (ps.isPanning) { ps.isPanning = false; scheduleSave(); return; }

    // Rubber band: select elements in box
    if (ps.isSelecting) {
      ps.isSelecting = false;
      const [sx, sy] = [ps.startSceneX, ps.startSceneY];
      const { scrollX, scrollY, zoom } = stateRef.current!.appState;
      const [ex, ey] = viewportToScene(ps.lastX, ps.lastY, scrollX, scrollY, zoom);
      if (Math.abs(ex - sx) > 3 || Math.abs(ey - sy) > 3) {
        const found = getElementsInSelectionBox(stateRef.current!.elements, sx, sy, ex, ey);
        const newIds = e.shiftKey ? new Set([...selectedIds, ...found.map((f) => f.id)]) : new Set(found.map((f) => f.id));
        setSelectedIds(newIds);
      }
      redraw(); return;
    }

    if (ps.handleDrag) {
      ps.handleDrag = null;
      redraw(); scheduleSave(); return;
    }

    if (ps.endpointIndex !== null) {
      ps.endpointIndex = null; ps.endpointElement = null;
      bindTargetRef.current = null;
      updateBindings(stateRef.current!.elements);
      redraw(); scheduleSave(); return;
    }

    if (ps.resizeHandle || (ps.dragElements && ps.dragElements.length > 0)) {
      ps.resizeHandle = null; ps.resizeElement = null; ps.resizeOriginal = null;
      ps.dragElements = null; ps.dragOffsets = [];
      scheduleSave(); return;
    }

    if (ps.newElement) {
      const el = ps.newElement;
      if (el.type !== "freedraw" && el.type !== "text" && Math.abs(el.width) < 3 && Math.abs(el.height) < 3) {
        el.isDeleted = true;
      }
      // Delete single-point freedraw (accidental click without dragging)
      if (el.type === "freedraw" && (!el.points || el.points.length <= 2) && Math.abs(el.width) < 3 && Math.abs(el.height) < 3) {
        el.isDeleted = true;
      }
      // Normalize freedraw
      if (el.type === "freedraw" && el.points && el.points.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of el.points) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
        if (minX !== 0 || minY !== 0) {
          for (const p of el.points) { p[0] -= minX; p[1] -= minY; }
          el.x += minX; el.y += minY;
        }
        el.width = maxX - minX;
        el.height = maxY - minY;
      }
      // Normalize negative dimensions (only for shapes, not for point-based elements)
      if (el.type !== "line" && el.type !== "arrow" && el.type !== "freedraw") {
        if (el.width < 0) { el.x += el.width; el.width = -el.width; }
        if (el.height < 0) { el.y += el.height; el.height = -el.height; }
      }

      // Finalize bindings for line/arrow
      if ((el.type === "line" || el.type === "arrow") && !el.isDeleted) {
        updateBindings(stateRef.current!.elements);
      }
      bindTargetRef.current = null;
      ps.newElement = null;
      setSelectedIds(new Set([el.id]));
      setActiveTool("selection");
      redraw(); scheduleSave();
    }
  }, [selectedIds, redraw, scheduleSave, pointerState, stateRef, bindTargetRef, setSelectedIds, setActiveTool]);
}
