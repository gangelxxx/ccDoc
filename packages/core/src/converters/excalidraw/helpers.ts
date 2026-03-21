import type { ExcalidrawElement } from "../../types.js";
import {
  PADDING_X,
  PADDING_Y,
  CHAR_WIDTH,
  LINE_HEIGHT,
  SHAPE_TYPES,
  ARROW_TYPES,
} from "./constants.js";

/** Estimate minimum size needed to fit label text inside a shape */
export function estimateTextSize(label: string, fontSize = 20): { minW: number; minH: number } {
  const lines = label.split("\n");
  const scale = fontSize / 20;
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  const minW = Math.ceil(maxLineLen * CHAR_WIDTH * scale) + PADDING_X;
  const minH = Math.ceil(lines.length * LINE_HEIGHT * scale) + PADDING_Y;
  return { minW, minH };
}

export function isShape(el: ExcalidrawElement): boolean {
  return SHAPE_TYPES.has(el.type) && !el.isDeleted;
}

export function isArrow(el: ExcalidrawElement): boolean {
  return ARROW_TYPES.has(el.type) && !el.isDeleted;
}

export function getLabel(el: ExcalidrawElement): string {
  if (el.type === "text") return el.text ?? "";
  return el.boundText ?? "";
}

export function buildElementMap(elements: ExcalidrawElement[]): Map<string, ExcalidrawElement> {
  const map = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    map.set(el.id, el);
  }
  return map;
}

export function centerOf(el: ExcalidrawElement): [number, number] {
  return [el.x + el.width / 2, el.y + el.height / 2];
}

export function makeId(counter: number): string {
  return `el-${Date.now()}-${counter}`;
}

export function makeSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function edgeAnchor(
  from: ExcalidrawElement,
  toward: [number, number],
): { anchor: [number, number]; point: [number, number] } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const hw = from.width / 2;
  const hh = from.height / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;

  if (dx === 0 && dy === 0) return { anchor: [0.5, 0.5], point: [cx, cy] };

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  let ex: number, ey: number;

  if (absDx * hh > absDy * hw) {
    const sign = dx > 0 ? 1 : -1;
    ex = cx + sign * hw;
    ey = cy + (dy / absDx) * hw;
  } else {
    const sign = dy > 0 ? 1 : -1;
    ey = cy + sign * hh;
    ex = cx + (dx / absDy) * hh;
  }

  const anchorX = hw > 0 ? (ex - from.x) / from.width : 0.5;
  const anchorY = hh > 0 ? (ey - from.y) / from.height : 0.5;

  return {
    anchor: [Math.max(0, Math.min(1, anchorX)), Math.max(0, Math.min(1, anchorY))],
    point: [ex, ey],
  };
}

export function resolveBindingLabel(
  binding: ExcalidrawElement["startBinding"],
  elMap: Map<string, ExcalidrawElement>,
  labelMap: Map<string, string>,
): string | null {
  if (!binding) return null;
  const label = labelMap.get(binding.elementId);
  if (label) return label;
  const el = elMap.get(binding.elementId);
  if (el) return getLabel(el) || null;
  return null;
}

export function coordLabel(el: ExcalidrawElement, end: "start" | "end"): string {
  if (end === "start") {
    return `${Math.round(el.x)},${Math.round(el.y)}`;
  }
  const pts = el.points;
  if (pts && pts.length >= 2) {
    const last = pts[pts.length - 1];
    return `${Math.round(el.x + last[0])},${Math.round(el.y + last[1])}`;
  }
  return `${Math.round(el.x + el.width)},${Math.round(el.y + el.height)}`;
}
