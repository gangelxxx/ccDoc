import type { DrawElement, ResizeHandle } from "../drawing-engine.js";

export interface PointerState {
  isDown: boolean;
  startX: number;
  startY: number;
  startSceneX: number;
  startSceneY: number;
  lastX: number;
  lastY: number;
  newElement: DrawElement | null;
  dragElements: DrawElement[] | null;
  dragOffsets: { id: string; dx: number; dy: number }[];
  resizeHandle: ResizeHandle | null;
  resizeElement: DrawElement | null;
  resizeOriginal: { x: number; y: number; width: number; height: number } | null;
  endpointIndex: number | null;
  endpointElement: DrawElement | null;
  isPanning: boolean;
  panStartScrollX: number;
  panStartScrollY: number;
  isSelecting: boolean;
  handleDrag: { element: DrawElement; segIndex: number; cpIndex: 0 | 1 } | null;
}

export interface TextEditingState {
  el: DrawElement;
  x: number;
  y: number;
  isBoundText?: boolean;
}

export interface SidebarDragState {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

export function createInitialPointerState(): PointerState {
  return {
    isDown: false,
    startX: 0,
    startY: 0,
    startSceneX: 0,
    startSceneY: 0,
    lastX: 0,
    lastY: 0,
    newElement: null,
    dragElements: null,
    dragOffsets: [],
    resizeHandle: null,
    resizeElement: null,
    resizeOriginal: null,
    endpointIndex: null,
    endpointElement: null,
    isPanning: false,
    panStartScrollX: 0,
    panStartScrollY: 0,
    isSelecting: false,
    handleDrag: null,
  };
}
