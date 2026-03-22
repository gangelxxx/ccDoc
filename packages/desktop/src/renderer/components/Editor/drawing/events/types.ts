import type { DrawElement, DrawState, ToolType } from "../../drawing-engine.js";
import type { PointerState, TextEditingState } from "../types.js";

/**
 * Shared refs & callbacks used by all pointer event handlers.
 * Extracted to avoid passing 20+ individual parameters to each sub-module.
 */
export interface CanvasEventContext {
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

  getSceneCoords: (e: { clientX: number; clientY: number }) => [number, number];
}
