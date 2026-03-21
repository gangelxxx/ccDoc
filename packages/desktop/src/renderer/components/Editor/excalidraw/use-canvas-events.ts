import { useCallback, useMemo } from "react";
import type { DrawElement, DrawState, ToolType } from "../drawing-engine.js";
import {
  hitTest, getResizeHandleAtPoint, getEndpointAtPoint,
  viewportToScene, initHandlesFromCatmullRom,
} from "../drawing-engine.js";
import type { PointerState, TextEditingState } from "./types.js";
import type { CanvasEventContext } from "./events/types.js";
import { usePointerDown } from "./events/pointer-down.js";
import { usePointerMove } from "./events/pointer-move.js";
import { usePointerUp } from "./events/pointer-up.js";

interface UseCanvasEventsParams {
  stateRef: React.RefObject<DrawState>;
  pointerState: React.RefObject<PointerState>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  bindTargetRef: React.MutableRefObject<DrawElement | null>;
  activeToolRef: React.RefObject<ToolType>;
  selectedIdsRef: React.RefObject<Set<string>>;
  textEditingRef: React.RefObject<TextEditingState | null>;

  activeTool: ToolType;
  selectedIds: Set<string>;
  strokeColor: string;
  bgColor: string;
  strokeWidth: number;
  textEditing: TextEditingState | null;

  setActiveTool: (tool: ToolType) => void;
  setSelectedIds: (ids: Set<string>) => void;

  pushHistory: () => void;
  redraw: () => void;
  redrawImmediate: () => void;
  scheduleSave: () => void;
  updateCursor: (cursor: string) => void;
  commitTextEdit: () => void;
  startTextEditing: (el: DrawElement) => void;
  startBoundTextEditing: (el: DrawElement) => void;
}

export function useCanvasEvents(params: UseCanvasEventsParams) {
  const {
    stateRef, pointerState, containerRef, bindTargetRef,
    activeToolRef, selectedIdsRef, textEditingRef,
    activeTool, selectedIds, strokeColor, bgColor, strokeWidth, textEditing,
    setActiveTool, setSelectedIds,
    pushHistory, redraw, redrawImmediate, scheduleSave,
    updateCursor, commitTextEdit, startTextEditing, startBoundTextEditing,
  } = params;

  // --- Pointer helpers ---
  const getSceneCoords = useCallback((e: { clientX: number; clientY: number }): [number, number] => {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    const { scrollX, scrollY, zoom } = stateRef.current!.appState;
    return viewportToScene(vx, vy, scrollX, scrollY, zoom);
  }, [containerRef, stateRef]);

  // Build shared context for event sub-modules
  const ctx: CanvasEventContext = useMemo(() => ({
    stateRef, pointerState, containerRef, bindTargetRef,
    activeToolRef, selectedIdsRef, textEditingRef,
    activeTool, selectedIds, strokeColor, bgColor, strokeWidth, textEditing,
    setActiveTool, setSelectedIds,
    pushHistory, redraw, redrawImmediate, scheduleSave,
    updateCursor, commitTextEdit, startTextEditing, startBoundTextEditing,
    getSceneCoords,
  }), [
    stateRef, pointerState, containerRef, bindTargetRef,
    activeToolRef, selectedIdsRef, textEditingRef,
    activeTool, selectedIds, strokeColor, bgColor, strokeWidth, textEditing,
    setActiveTool, setSelectedIds,
    pushHistory, redraw, redrawImmediate, scheduleSave,
    updateCursor, commitTextEdit, startTextEditing, startBoundTextEditing,
    getSceneCoords,
  ]);

  // --- Delegated handlers ---
  const onPointerDown = usePointerDown(ctx);
  usePointerMove(ctx);
  const onPointerUp = usePointerUp(ctx);

  // --- Right-click to delete control points ---
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const [sx, sy] = getSceneCoords(e as unknown as React.PointerEvent);
    const zoom = stateRef.current!.appState.zoom;
    for (const el of stateRef.current!.elements) {
      if (el.isDeleted || !selectedIds.has(el.id)) continue;
      if (el.type !== "line" && el.type !== "arrow") continue;
      if (!el.points || el.points.length <= 2) continue;
      const epIdx = getEndpointAtPoint(el, sx, sy, zoom);
      if (epIdx !== null && epIdx > 0 && epIdx < el.points.length - 1) {
        e.preventDefault();
        pushHistory();
        el.points.splice(epIdx, 1);
        const last = el.points[el.points.length - 1];
        el.width = last[0]; el.height = last[1];
        // Recalculate handles after point removal
        if (el.points.length >= 3 && el.arrowType === "round") {
          el.handles = initHandlesFromCatmullRom(el.points);
        } else {
          el.handles = undefined;
        }
        redraw(); scheduleSave();
        return;
      }
    }
  }, [selectedIds, getSceneCoords, pushHistory, redraw, scheduleSave, stateRef]);

  // --- Double-click: Shift+dblclick selects all elements of the same type, plain dblclick edits text ---
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const [sx, sy] = getSceneCoords(e);
    const elements = stateRef.current!.elements;
    // Find the topmost hit element
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.isDeleted) continue;
      if (!hitTest(el, sx, sy)) continue;
      // For text elements, keep text editing behavior on plain double-click
      if (el.type === "text" && !e.shiftKey) {
        startTextEditing(el);
        return;
      }
      // For lines/arrows, double-click to add/edit label
      if ((el.type === "line" || el.type === "arrow") && !e.shiftKey) {
        startBoundTextEditing(el);
        return;
      }
      // Shift+double-click: select all elements of the same type
      if (e.shiftKey) {
        const targetType = el.type;
        const ids = new Set<string>();
        for (const other of elements) {
          if (!other.isDeleted && other.type === targetType) {
            ids.add(other.id);
          }
        }
        setSelectedIds(ids);
      }
      return;
    }
  }, [getSceneCoords, startTextEditing, startBoundTextEditing, stateRef, setSelectedIds]);

  // --- Wheel for zoom ---
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const appState = stateRef.current!.appState;
    if (e.ctrlKey || e.metaKey) {
      const container = containerRef.current!;
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = appState.zoom;
      const newZoom = Math.max(0.1, Math.min(10, oldZoom * (1 - e.deltaY * 0.001)));
      appState.scrollX = mx - (mx - appState.scrollX) * (newZoom / oldZoom);
      appState.scrollY = my - (my - appState.scrollY) * (newZoom / oldZoom);
      appState.zoom = newZoom;
    } else {
      appState.scrollX -= e.deltaX;
      appState.scrollY -= e.deltaY;
    }
    redraw();
  }, [redraw, stateRef, containerRef]);

  return {
    getSceneCoords,
    onPointerDown,
    onPointerUp,
    onDoubleClick,
    onContextMenu,
    onWheel,
  };
}
