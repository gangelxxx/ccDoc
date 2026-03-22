import { useCallback } from "react";
import type { DrawElement, DrawState } from "../../drawing-engine.js";
import {
  duplicateElements,
  moveElementsToFront,
  moveElementsToBack,
  initHandlesFromCatmullRom,
} from "../../drawing-engine.js";

interface UseElementOpsParams {
  stateRef: React.RefObject<DrawState>;
  selectedIds: Set<string>;
  selectedIdsRef: React.RefObject<Set<string>>;
  clipboardRef: React.MutableRefObject<DrawElement[]>;
  pushHistory: () => void;
  redraw: () => void;
  scheduleSave: () => void;
  forceRender: React.Dispatch<React.SetStateAction<number>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStrokeColor: React.Dispatch<React.SetStateAction<string>>;
  setBgColor: React.Dispatch<React.SetStateAction<string>>;
  setStrokeWidth: React.Dispatch<React.SetStateAction<number>>;
}

export function useElementOps({
  stateRef,
  selectedIds,
  selectedIdsRef,
  clipboardRef,
  pushHistory,
  redraw,
  scheduleSave,
  forceRender,
  setSelectedIds,
  setStrokeColor,
  setBgColor,
  setStrokeWidth,
}: UseElementOpsParams) {
  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory();
    for (const el of stateRef.current!.elements) {
      if (selectedIds.has(el.id)) el.isDeleted = true;
    }
    setSelectedIds(new Set());
    redraw();
    scheduleSave();
  }, [selectedIds, pushHistory, redraw, scheduleSave, stateRef, setSelectedIds]);

  const copySelected = useCallback(() => {
    clipboardRef.current = stateRef.current!.elements
      .filter((el) => selectedIds.has(el.id) && !el.isDeleted)
      .map((el) => structuredClone(el));
  }, [selectedIds, stateRef, clipboardRef]);

  const paste = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    pushHistory();
    const dupes = duplicateElements(
      clipboardRef.current,
      new Set(clipboardRef.current.map((e) => e.id)),
    );
    stateRef.current!.elements.push(...dupes);
    setSelectedIds(new Set(dupes.map((e) => e.id)));
    // Shift clipboard for next paste
    clipboardRef.current = dupes.map((el) => structuredClone(el));
    redraw();
    scheduleSave();
  }, [pushHistory, redraw, scheduleSave, stateRef, clipboardRef, setSelectedIds]);

  const duplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory();
    const dupes = duplicateElements(stateRef.current!.elements, selectedIds);
    stateRef.current!.elements.push(...dupes);
    setSelectedIds(new Set(dupes.map((e) => e.id)));
    redraw();
    scheduleSave();
  }, [selectedIds, pushHistory, redraw, scheduleSave, stateRef, setSelectedIds]);

  const bringToFront = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory();
    stateRef.current!.elements = moveElementsToFront(stateRef.current!.elements, selectedIds);
    redraw();
    scheduleSave();
  }, [selectedIds, pushHistory, redraw, scheduleSave, stateRef]);

  const sendToBack = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory();
    stateRef.current!.elements = moveElementsToBack(stateRef.current!.elements, selectedIds);
    redraw();
    scheduleSave();
  }, [selectedIds, pushHistory, redraw, scheduleSave, stateRef]);

  const updateSelectedProps = useCallback(
    (updates: Partial<DrawElement>) => {
      // Update defaults for future elements
      if (updates.strokeColor !== undefined) setStrokeColor(updates.strokeColor);
      if (updates.backgroundColor !== undefined) setBgColor(updates.backgroundColor);
      if (updates.strokeWidth !== undefined) setStrokeWidth(updates.strokeWidth);
      // If elements selected, update them too
      const ids = selectedIdsRef.current;
      if (ids.size > 0) {
        pushHistory();
        for (const el of stateRef.current!.elements) {
          if (!ids.has(el.id) || el.isDeleted) continue;
          Object.assign(el, updates);
          // When switching to sharp, remove intermediate points
          if (updates.arrowType === "sharp" && el.points && el.points.length > 2) {
            el.points = [el.points[0], el.points[el.points.length - 1]];
            const last = el.points[1];
            el.width = last[0];
            el.height = last[1];
          }
          // Clear bezier handles when switching to sharp or elbow
          if (updates.arrowType === "sharp" || updates.arrowType === "elbow") {
            el.handles = undefined;
          }
          // Elbow keeps all intermediate points -- just renders them as straight segments
          // When switching to round, initialize handles from Catmull-Rom if missing
          if (
            updates.arrowType === "round" &&
            el.points &&
            el.points.length >= 3 &&
            !el.handles
          ) {
            el.handles = initHandlesFromCatmullRom(el.points);
          }
        }
        redraw();
        scheduleSave();
      }
      forceRender((n) => n + 1);
    },
    [
      pushHistory,
      redraw,
      scheduleSave,
      stateRef,
      selectedIdsRef,
      forceRender,
      setStrokeColor,
      setBgColor,
      setStrokeWidth,
    ],
  );

  return {
    deleteSelected,
    copySelected,
    paste,
    duplicate,
    bringToFront,
    sendToBack,
    updateSelectedProps,
  };
}
