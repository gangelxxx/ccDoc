import { useCallback } from "react";
import {
  hitTest, getResizeHandleAtPoint, getEndpointAtPoint,
  getHandleAtPoint, getMidpointAtPoint, getSegmentMidpoint,
  snapToGrid, findBindTarget, getBindingPoint, computeAnchor,
  initHandlesFromCatmullRom, createElement,
} from "../../drawing-engine.js";
import type { CanvasEventContext } from "./types.js";

export function usePointerDown(ctx: CanvasEventContext) {
  return useCallback((e: React.PointerEvent) => {
    const {
      textEditing, commitTextEdit, containerRef, stateRef, pointerState,
      activeTool, selectedIds, strokeColor, bgColor, strokeWidth,
      pushHistory, redraw, setActiveTool, setSelectedIds,
      startTextEditing, getSceneCoords,
    } = ctx;

    if (textEditing) { commitTextEdit(); return; }
    (e.target as Element).setPointerCapture(e.pointerId);
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    const [sx, sy] = getSceneCoords(e);
    const grid = stateRef.current!.appState.gridSize;

    const ps = pointerState.current!;
    ps.isDown = true;
    ps.startX = vx; ps.startY = vy;
    ps.startSceneX = sx; ps.startSceneY = sy;
    ps.lastX = vx; ps.lastY = vy;
    ps.newElement = null;
    ps.dragElements = null; ps.dragOffsets = [];
    ps.resizeHandle = null;
    ps.endpointIndex = null; ps.endpointElement = null;
    ps.isSelecting = false;
    ps.handleDrag = null;

    // Panning
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      ps.isPanning = true;
      ps.panStartScrollX = stateRef.current!.appState.scrollX;
      ps.panStartScrollY = stateRef.current!.appState.scrollY;
      return;
    }

    if (activeTool === "selection") {
      // Check resize handles
      for (const el of stateRef.current!.elements) {
        if (el.isDeleted || !selectedIds.has(el.id)) continue;
        const handle = getResizeHandleAtPoint(el, sx, sy, stateRef.current!.appState.zoom);
        if (handle) {
          ps.resizeHandle = handle;
          ps.resizeElement = el;
          ps.resizeOriginal = { x: el.x, y: el.y, width: el.width, height: el.height };
          pushHistory();
          return;
        }
      }

      // Check Bezier handle hit (highest priority for curve editing)
      for (const el of stateRef.current!.elements) {
        if (el.isDeleted || !selectedIds.has(el.id)) continue;
        const handleHit = getHandleAtPoint(el, sx, sy, stateRef.current!.appState.zoom);
        if (handleHit) {
          pushHistory();
          ps.handleDrag = { element: el, segIndex: handleHit.segIndex, cpIndex: handleHit.cpIndex };
          return;
        }
      }

      // Check endpoint handles for lines/arrows
      for (const el of stateRef.current!.elements) {
        if (el.isDeleted || !selectedIds.has(el.id)) continue;
        const epIdx = getEndpointAtPoint(el, sx, sy, stateRef.current!.appState.zoom);
        if (epIdx !== null) {
          ps.endpointIndex = epIdx;
          ps.endpointElement = el;
          pushHistory();
          return;
        }
      }

      // Check midpoint handles for lines/arrows (insert new control point)
      for (const el of stateRef.current!.elements) {
        if (el.isDeleted || !selectedIds.has(el.id)) continue;
        const segIdx = getMidpointAtPoint(el, sx, sy, stateRef.current!.appState.zoom);
        if (segIdx !== null && el.points) {
          pushHistory();
          const [mx, my] = getSegmentMidpoint(el, segIdx);
          el.points.splice(segIdx + 1, 0, [mx, my]);
          // Set arrowType to round so curves render
          if ((el.type === "arrow" || el.type === "line") && el.arrowType !== "round") {
            el.arrowType = "round";
          }
          // Initialize handles from Catmull-Rom after inserting point
          if (el.points.length >= 3) {
            el.handles = initHandlesFromCatmullRom(el.points);
          }
          ps.endpointIndex = segIdx + 1;
          ps.endpointElement = el;
          redraw();
          return;
        }
      }

      // Hit test
      const elements = stateRef.current!.elements;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (hitTest(el, sx, sy)) {
          // Shift+click: toggle in selection
          if (e.shiftKey) {
            const newIds = new Set(selectedIds);
            if (newIds.has(el.id)) newIds.delete(el.id);
            else newIds.add(el.id);
            setSelectedIds(newIds);
          } else if (!selectedIds.has(el.id)) {
            setSelectedIds(new Set([el.id]));
          }
          // Prepare multi-drag
          const dragIds = e.shiftKey ? new Set([...selectedIds, el.id]) : (selectedIds.has(el.id) ? selectedIds : new Set([el.id]));
          const dragEls = elements.filter((e) => dragIds.has(e.id) && !e.isDeleted);
          ps.dragElements = dragEls;
          ps.dragOffsets = dragEls.map((de) => ({ id: de.id, dx: sx - de.x, dy: sy - de.y }));
          pushHistory();
          redraw();
          return;
        }
      }

      // Empty space: start rubber band selection (or deselect without shift)
      if (!e.shiftKey) setSelectedIds(new Set());
      ps.isSelecting = true;
      redraw();

    } else if (activeTool === "text") {
      // Create text element and start inline editing
      pushHistory();
      const snappedX = snapToGrid(sx, grid);
      const snappedY = snapToGrid(sy, grid);
      const el = createElement("text", snappedX, snappedY, { strokeColor, fontSize: 20 });
      el.text = "";
      el.width = 200;
      el.height = 24;
      stateRef.current!.elements.push(el);
      setSelectedIds(new Set([el.id]));
      startTextEditing(el);
      setActiveTool("selection");
    } else {
      // Drawing
      pushHistory();
      const snappedX = snapToGrid(sx, grid);
      const snappedY = snapToGrid(sy, grid);
      const el = createElement(activeTool, snappedX, snappedY, {
        strokeColor, backgroundColor: bgColor, strokeWidth,
      });
      // Check start binding for line/arrow
      if (el.type === "line" || el.type === "arrow") {
        const excludeIds = new Set([el.id]);
        const target = findBindTarget(stateRef.current!.elements, snappedX, snappedY, excludeIds);
        if (target) {
          const [bx, by] = getBindingPoint(target, snappedX, snappedY);
          const [ax, ay] = computeAnchor(target, bx, by);
          el.startBinding = { elementId: target.id, anchorX: ax, anchorY: ay };
        }
      }
      ps.newElement = el;
      stateRef.current!.elements.push(el);
    }
  }, [ctx]);
}
