// Arrow/line endpoint binding to shapes

import type { DrawElement } from "./types.js";
import { hitTest, getElementCenter } from "./hit-testing.js";

const BIND_THRESHOLD = 20;
const BINDABLE_TYPES = new Set(["rectangle", "ellipse", "diamond", "image"]);

export function isBindableElement(el: DrawElement): boolean {
  return BINDABLE_TYPES.has(el.type) && !el.isDeleted;
}

/** Find the nearest bindable element to a scene point, excluding certain ids */
export function findBindTarget(
  elements: DrawElement[],
  sx: number,
  sy: number,
  excludeIds: Set<string>,
  threshold = BIND_THRESHOLD,
): DrawElement | null {
  let best: DrawElement | null = null;
  let bestDist = threshold;
  for (const el of elements) {
    if (!isBindableElement(el) || excludeIds.has(el.id)) continue;
    const [cx, cy] = getElementCenter(el);
    const dist = Math.hypot(sx - cx, sy - cy);
    // Also check if point is inside or near the element
    const inside = hitTest(el, sx, sy, threshold);
    if (inside && dist < bestDist + 200) {
      // Prefer closer center
      if (!best || dist < bestDist) {
        best = el;
        bestDist = dist;
      }
    }
  }
  return best;
}

/** Get the point on the boundary of a shape in the direction from center to fromXY */
export function getBindingPoint(
  target: DrawElement,
  fromX: number,
  fromY: number,
): [number, number] {
  const [cx, cy] = getElementCenter(target);
  const dx = fromX - cx;
  const dy = fromY - cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [cx, cy];
  const nx = dx / len;
  const ny = dy / len;

  switch (target.type) {
    case "ellipse": {
      const rx = Math.abs(target.width) / 2;
      const ry = Math.abs(target.height) / 2;
      if (rx === 0 || ry === 0) return [cx, cy];
      // Parametric: point on ellipse in direction (nx, ny)
      const scale = 1 / Math.hypot(nx / rx, ny / ry);
      return [cx + nx * scale, cy + ny * scale];
    }
    case "diamond": {
      const hw = Math.abs(target.width) / 2;
      const hh = Math.abs(target.height) / 2;
      if (hw === 0 || hh === 0) return [cx, cy];
      // Diamond boundary: |x/hw| + |y/hh| = 1
      const scale = 1 / (Math.abs(nx) / hw + Math.abs(ny) / hh);
      return [cx + nx * scale, cy + ny * scale];
    }
    default: {
      // Rectangle: find intersection with boundary
      const hw = Math.abs(target.width) / 2;
      const hh = Math.abs(target.height) / 2;
      if (hw === 0 || hh === 0) return [cx, cy];
      const tx = hw / Math.abs(nx || 0.0001);
      const ty = hh / Math.abs(ny || 0.0001);
      const t = Math.min(tx, ty);
      return [cx + nx * t, cy + ny * t];
    }
  }
}

/** Compute anchor (0..1) relative to element bounding box from an absolute point */
export function computeAnchor(
  target: DrawElement,
  absX: number,
  absY: number,
): [number, number] {
  const w = Math.abs(target.width) || 1;
  const h = Math.abs(target.height) || 1;
  const x0 = Math.min(target.x, target.x + target.width);
  const y0 = Math.min(target.y, target.y + target.height);
  return [
    Math.max(0, Math.min(1, (absX - x0) / w)),
    Math.max(0, Math.min(1, (absY - y0) / h)),
  ];
}

/** Reconstruct absolute point from anchor */
export function anchorToPoint(
  target: DrawElement,
  anchorX: number,
  anchorY: number,
): [number, number] {
  const x0 = Math.min(target.x, target.x + target.width);
  const y0 = Math.min(target.y, target.y + target.height);
  const w = Math.abs(target.width);
  const h = Math.abs(target.height);
  return [x0 + anchorX * w, y0 + anchorY * h];
}

/** Update all line/arrow bindings after elements have moved */
export function updateBindings(elements: DrawElement[]) {
  const byId = new Map<string, DrawElement>();
  for (const el of elements) {
    if (!el.isDeleted) byId.set(el.id, el);
  }
  for (const el of elements) {
    if (el.isDeleted) continue;
    if (el.type !== "line" && el.type !== "arrow") continue;
    if (!el.points || el.points.length < 2) continue;

    if (el.startBinding) {
      const target = byId.get(el.startBinding.elementId);
      if (target) {
        const [bx, by] = anchorToPoint(target, el.startBinding.anchorX, el.startBinding.anchorY);
        el.points[0] = [bx - el.x, by - el.y];
      } else {
        el.startBinding = null;
      }
    }
    if (el.endBinding) {
      const target = byId.get(el.endBinding.elementId);
      if (target) {
        const [bx, by] = anchorToPoint(target, el.endBinding.anchorX, el.endBinding.anchorY);
        const lastIdx = el.points.length - 1;
        el.points[lastIdx] = [bx - el.x, by - el.y];
        el.width = el.points[lastIdx][0];
        el.height = el.points[lastIdx][1];
      } else {
        el.endBinding = null;
      }
    }
  }
}
