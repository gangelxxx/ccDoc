import { useEffect } from "react";
import {
  hitTest, getResizeHandleAtPoint, getResizeHandleCursor, getEndpointAtPoint,
  getHandleAtPoint, getMidpointAtPoint,
  snapToGrid, findBindTarget, getBindingPoint, computeAnchor,
  updateBindings,
} from "../../drawing-engine.js";
import type { CanvasEventContext } from "./types.js";

/**
 * Native DOM pointermove listener with RAF throttle (like Excalidraw).
 * Registered as a useEffect because React synthetic events don't support
 * RAF-based coalescing natively.
 */
export function usePointerMove(ctx: CanvasEventContext) {
  const {
    containerRef, stateRef, pointerState, activeToolRef, selectedIdsRef,
    bindTargetRef, redrawImmediate, updateCursor,
  } = ctx;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let moveRafId = 0;
    let lastEvent: PointerEvent | null = null;

    const processMove = () => {
      moveRafId = 0;
      const e = lastEvent;
      if (!e) return;
      lastEvent = null;
      try {
        const ps = pointerState.current!;
        const rect = container.getBoundingClientRect();
        const vx = e.clientX - rect.left;
        const vy = e.clientY - rect.top;
        const { scrollX, scrollY, zoom } = stateRef.current!.appState;
        const sx = (vx - scrollX) / zoom;
        const sy = (vy - scrollY) / zoom;
        const grid = stateRef.current!.appState.gridSize;

        if (!ps.isDown) {
          if (activeToolRef.current !== "selection") {
            updateCursor("crosshair");
            return;
          }
          for (const el of stateRef.current!.elements) {
            if (el.isDeleted || !selectedIdsRef.current!.has(el.id)) continue;
            const handleHit = getHandleAtPoint(el, sx, sy, zoom);
            if (handleHit) { updateCursor("crosshair"); return; }
            const epIdx = getEndpointAtPoint(el, sx, sy, zoom);
            if (epIdx !== null) { updateCursor("crosshair"); return; }
            const midIdx = getMidpointAtPoint(el, sx, sy, zoom);
            if (midIdx !== null) { updateCursor("pointer"); return; }
            const handle = getResizeHandleAtPoint(el, sx, sy, zoom);
            if (handle) { updateCursor(getResizeHandleCursor(handle)); return; }
          }
          for (let i = stateRef.current!.elements.length - 1; i >= 0; i--) {
            if (hitTest(stateRef.current!.elements[i], sx, sy)) { updateCursor("move"); return; }
          }
          updateCursor("default");
          return;
        }

        ps.lastX = vx;
        ps.lastY = vy;

        if (ps.isPanning) {
          stateRef.current!.appState.scrollX = ps.panStartScrollX + (vx - ps.startX);
          stateRef.current!.appState.scrollY = ps.panStartScrollY + (vy - ps.startY);
          redrawImmediate(); return;
        }
        if (ps.isSelecting) { redrawImmediate(); return; }
        if (ps.resizeHandle && ps.resizeElement && ps.resizeOriginal) {
          const el = ps.resizeElement;
          const orig = ps.resizeOriginal;
          const h = ps.resizeHandle;
          const gsx = snapToGrid(sx, grid);
          const gsy = snapToGrid(sy, grid);
          // Normalize: use min/max so handles match visual bounds
          const ox1 = Math.min(orig.x, orig.x + orig.width);
          const oy1 = Math.min(orig.y, orig.y + orig.height);
          const ox2 = Math.max(orig.x, orig.x + orig.width);
          const oy2 = Math.max(orig.y, orig.y + orig.height);
          let nx1 = ox1, ny1 = oy1, nx2 = ox2, ny2 = oy2;
          if (h.includes("e")) nx2 = gsx;
          if (h.includes("w")) nx1 = gsx;
          if (h.includes("s")) ny2 = gsy;
          if (h.includes("n")) ny1 = gsy;
          el.x = nx1; el.y = ny1;
          el.width = nx2 - nx1; el.height = ny2 - ny1;
          updateBindings(stateRef.current!.elements);
          redrawImmediate(); return;
        }
        if (ps.handleDrag) {
          const { element: hdEl, segIndex, cpIndex } = ps.handleDrag;
          if (hdEl.handles && hdEl.handles[segIndex] && hdEl.points) {
            const h = hdEl.handles[segIndex];
            const localX = sx - hdEl.x;
            const localY = sy - hdEl.y;
            if (cpIndex === 0) {
              h[0] = localX; h[1] = localY;
              // Mirror: cp2 of previous segment (both attached to pts[segIndex])
              if (!e.ctrlKey && segIndex > 0 && hdEl.handles[segIndex - 1]) {
                const anchor = hdEl.points[segIndex];
                const mirH = hdEl.handles[segIndex - 1];
                mirH[2] = 2 * anchor[0] - localX;
                mirH[3] = 2 * anchor[1] - localY;
              }
            } else {
              h[2] = localX; h[3] = localY;
              // Mirror: cp1 of next segment (both attached to pts[segIndex + 1])
              if (!e.ctrlKey && segIndex + 1 < hdEl.handles.length && hdEl.handles[segIndex + 1]) {
                const anchor = hdEl.points[segIndex + 1];
                const mirH = hdEl.handles[segIndex + 1];
                mirH[0] = 2 * anchor[0] - localX;
                mirH[1] = 2 * anchor[1] - localY;
              }
            }
          }
          redrawImmediate(); return;
        }
        if (ps.endpointIndex !== null && ps.endpointElement) {
          const el = ps.endpointElement;
          const idx = ps.endpointIndex;
          if (el.points && idx < el.points.length) {
            const gsx = snapToGrid(sx, grid);
            const gsy = snapToGrid(sy, grid);
            // Try to bind to a shape
            const excludeIds = new Set([el.id]);
            const target = findBindTarget(stateRef.current!.elements, gsx, gsy, excludeIds);
            bindTargetRef.current = target;
            const isStart = idx === 0;
            const isEnd = idx === el.points.length - 1;
            let newPt: [number, number];
            if (target) {
              const [bx, by] = getBindingPoint(target, gsx, gsy);
              newPt = [bx - el.x, by - el.y];
              const [axx, ayy] = computeAnchor(target, bx, by);
              if (isStart) el.startBinding = { elementId: target.id, anchorX: axx, anchorY: ayy };
              if (isEnd) el.endBinding = { elementId: target.id, anchorX: axx, anchorY: ayy };
            } else {
              newPt = [gsx - el.x, gsy - el.y];
              if (isStart) el.startBinding = null;
              if (isEnd) el.endBinding = null;
            }
            const oldPt = el.points[idx];
            const dx = newPt[0] - oldPt[0];
            const dy = newPt[1] - oldPt[1];
            el.points[idx] = newPt;
            // Shift handles of adjacent segments by the same delta (preserve user adjustments)
            if (el.handles && el.points.length >= 3) {
              // Segment before this point (idx-1): shift cp2
              if (idx > 0 && el.handles[idx - 1]) {
                el.handles[idx - 1][2] += dx;
                el.handles[idx - 1][3] += dy;
              }
              // Segment after this point (idx): shift cp1
              if (idx < el.handles.length && el.handles[idx]) {
                el.handles[idx][0] += dx;
                el.handles[idx][1] += dy;
              }
            }
            const last = el.points[el.points.length - 1];
            el.width = last[0]; el.height = last[1];
          }
          redrawImmediate(); return;
        }
        if (ps.dragElements && ps.dragElements.length > 0) {
          for (const off of ps.dragOffsets) {
            const el = ps.dragElements.find((de) => de.id === off.id);
            if (el) { el.x = snapToGrid(sx - off.dx, grid); el.y = snapToGrid(sy - off.dy, grid); }
          }
          updateBindings(stateRef.current!.elements);
          redrawImmediate(); return;
        }
        const el = ps.newElement;
        if (!el) return;
        if (el.type === "freedraw") {
          el.points!.push([sx - el.x, sy - el.y]);
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of el.points!) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
          el.width = maxX - minX;
          el.height = maxY - minY;
        } else if (el.type === "line" || el.type === "arrow") {
          const gsx = snapToGrid(sx, grid);
          const gsy = snapToGrid(sy, grid);
          const excludeIds = new Set([el.id]);
          const target = findBindTarget(stateRef.current!.elements, gsx, gsy, excludeIds);
          bindTargetRef.current = target;
          let relX: number, relY: number;
          if (target) {
            const [bx, by] = getBindingPoint(target, gsx, gsy);
            relX = bx - el.x; relY = by - el.y;
            const [eax, eay] = computeAnchor(target, bx, by);
            el.endBinding = { elementId: target.id, anchorX: eax, anchorY: eay };
          } else {
            relX = gsx - el.x; relY = gsy - el.y;
            el.endBinding = null;
          }
          if (el.points!.length === 1) el.points!.push([relX, relY]);
          else el.points![el.points!.length - 1] = [relX, relY];
          el.width = relX; el.height = relY;
        } else {
          el.width = snapToGrid(sx, grid) - el.x;
          el.height = snapToGrid(sy, grid) - el.y;
          if (e.shiftKey) {
            const size = Math.max(Math.abs(el.width), Math.abs(el.height));
            el.width = Math.sign(el.width) * size;
            el.height = Math.sign(el.height) * size;
          }
        }
        redrawImmediate();
      } catch (_) { /* ignore */ }
    };

    const onPointerMove = (e: PointerEvent) => {
      lastEvent = e;
      if (!moveRafId) {
        moveRafId = requestAnimationFrame(processMove);
      }
    };

    container.addEventListener("pointermove", onPointerMove);
    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      if (moveRafId) cancelAnimationFrame(moveRafId);
    };
  }, [redrawImmediate, updateCursor, containerRef, stateRef, pointerState, activeToolRef, selectedIdsRef, bindTargetRef]);
}
