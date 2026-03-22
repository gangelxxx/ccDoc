// State management: ID generation, default state, serialization, element creation

import type { DrawElement, DrawState, ToolType } from "./types.js";

// --- ID generation ---
let idCounter = 0;
export function generateId(): string {
  return `el-${Date.now()}-${idCounter++}`;
}

export function createDefaultState(): DrawState {
  return {
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
    },
  };
}

export function parseDrawState(json: string): DrawState {
  try {
    const parsed = JSON.parse(json);
    return {
      elements: parsed.elements || [],
      appState: {
        viewBackgroundColor: parsed.appState?.viewBackgroundColor ?? "#ffffff",
        gridSize: parsed.appState?.gridSize ?? null,
        zoom: parsed.appState?.zoom ?? 1,
        scrollX: parsed.appState?.scrollX ?? 0,
        scrollY: parsed.appState?.scrollY ?? 0,
      },
    };
  } catch {
    return createDefaultState();
  }
}

export function serializeDrawState(state: DrawState): string {
  return JSON.stringify({
    elements: state.elements.filter((el) => !el.isDeleted),
    appState: state.appState,
  });
}

// --- Element creation helpers ---
export function createElement(
  type: ToolType,
  x: number,
  y: number,
  defaults: Partial<DrawElement> = {},
): DrawElement {
  return {
    id: generateId(),
    type,
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: defaults.strokeColor ?? "#1a1a1a",
    backgroundColor: defaults.backgroundColor ?? "transparent",
    strokeWidth: defaults.strokeWidth ?? 2,
    strokeStyle: defaults.strokeStyle ?? "solid",
    opacity: defaults.opacity ?? 100,
    seed: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    points: type === "freedraw" || type === "line" || type === "arrow" ? [[0, 0]] : undefined,
    text: type === "text" ? "" : undefined,
    fontSize: type === "text" ? (defaults.fontSize ?? 20) : undefined,
    fontFamily: type === "text" ? (defaults.fontFamily ?? "hand") : undefined,
    textAlign: type === "text" ? (defaults.textAlign ?? "left") : undefined,
    roundness: (type === "rectangle" || type === "diamond" || type === "line") ? (defaults.roundness ?? "round") : undefined,
    arrowhead: type === "arrow" ? (defaults.arrowhead ?? "arrow") : undefined,
    arrowType: (type === "arrow" || type === "line") ? (defaults.arrowType ?? "sharp") : undefined,
    startArrowhead: type === "arrow" ? (defaults.startArrowhead ?? null) : undefined,
    imageData: type === "image" ? defaults.imageData : undefined,
  };
}
