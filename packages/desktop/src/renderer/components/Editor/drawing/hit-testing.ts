// Hit testing functions for all element types, resize handles, endpoints, midpoints

import type { DrawElement, ResizeHandle } from "./types.js";
import { getCurveControlPoints, shouldUseCurves, getSegmentMidpoint } from "./curves.js";

const HIT_THRESHOLD = 8;

export function hitTest(
  element: DrawElement,
  sx: number,
  sy: number,
  threshold = HIT_THRESHOLD,
): boolean {
  if (element.isDeleted) return false;

  switch (element.type) {
    case "rectangle":
    case "text":
    case "image":
      return hitTestRect(element, sx, sy, threshold);
    case "ellipse":
      return hitTestEllipse(element, sx, sy, threshold);
    case "diamond":
      return hitTestDiamond(element, sx, sy, threshold);
    case "line":
    case "arrow":
      return hitTestLine(element, sx, sy, threshold);
    case "freedraw":
      return hitTestFreedraw(element, sx, sy, threshold);
    default:
      return false;
  }
}

function hitTestRect(el: DrawElement, sx: number, sy: number, t: number): boolean {
  return sx >= el.x - t && sx <= el.x + el.width + t && sy >= el.y - t && sy <= el.y + el.height + t;
}

function hitTestEllipse(el: DrawElement, sx: number, sy: number, t: number): boolean {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rx = Math.abs(el.width) / 2 + t;
  const ry = Math.abs(el.height) / 2 + t;
  if (rx === 0 || ry === 0) return false;
  const dx = sx - cx;
  const dy = sy - cy;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

function hitTestDiamond(el: DrawElement, sx: number, sy: number, t: number): boolean {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const hw = Math.abs(el.width) / 2 + t;
  const hh = Math.abs(el.height) / 2 + t;
  if (hw === 0 || hh === 0) return false;
  return Math.abs(sx - cx) / hw + Math.abs(sy - cy) / hh <= 1;
}

function hitTestLine(el: DrawElement, sx: number, sy: number, t: number): boolean {
  if (el.points && el.points.length >= 2) {
    // Elbow: test against actual straight segments
    if (el.arrowType === "elbow") {
      for (let i = 0; i < el.points.length - 1; i++) {
        const ax = el.x + el.points[i][0], ay = el.y + el.points[i][1];
        const bx = el.x + el.points[i + 1][0], by = el.y + el.points[i + 1][1];
        if (distToSegment(sx, sy, ax, ay, bx, by) < t) return true;
      }
      return false;
    }
    const isCurved = el.arrowType !== 'sharp' && (el.arrowType === 'round' || (el.handles && el.handles.length > 0));
    for (let i = 0; i < el.points.length - 1; i++) {
      if (isCurved) {
        // Sample bezier curve and check distance to sampled segments
        const { cp1, cp2 } = getCurveControlPoints(el.points, i, el.handles);
        const p0 = el.points[i];
        const p3 = el.points[i + 1];
        const STEPS = 16;
        let prevX = el.x + p0[0], prevY = el.y + p0[1];
        for (let s = 1; s <= STEPS; s++) {
          const u = s / STEPS;
          const inv = 1 - u;
          const cx = inv*inv*inv*p0[0] + 3*inv*inv*u*cp1[0] + 3*inv*u*u*cp2[0] + u*u*u*p3[0];
          const cy = inv*inv*inv*p0[1] + 3*inv*inv*u*cp1[1] + 3*inv*u*u*cp2[1] + u*u*u*p3[1];
          const curX = el.x + cx, curY = el.y + cy;
          if (distToSegment(sx, sy, prevX, prevY, curX, curY) <= t) return true;
          prevX = curX; prevY = curY;
        }
      } else {
        const [ax, ay] = el.points[i];
        const [bx, by] = el.points[i + 1];
        if (distToSegment(sx, sy, el.x + ax, el.y + ay, el.x + bx, el.y + by) <= t) return true;
      }
    }
    return false;
  }
  return distToSegment(sx, sy, el.x, el.y, el.x + el.width, el.y + el.height) <= t;
}

function hitTestFreedraw(el: DrawElement, sx: number, sy: number, t: number): boolean {
  if (!el.points || el.points.length === 0) return false;
  for (let i = 0; i < el.points.length - 1; i++) {
    const [ax, ay] = el.points[i];
    const [bx, by] = el.points[i + 1];
    if (distToSegment(sx, sy, el.x + ax, el.y + ay, el.x + bx, el.y + by) <= t + el.strokeWidth) return true;
  }
  return false;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// --- Resize handle hit testing ---

export function getEndpointAtPoint(
  el: DrawElement,
  sx: number,
  sy: number,
  zoom: number,
): number | null {
  if (!el.points || el.points.length < 2) return null;
  if (el.type !== "line" && el.type !== "arrow") return null;
  const handleSize = 8 / zoom;
  for (let i = 0; i < el.points.length; i++) {
    const px = el.x + el.points[i][0];
    const py = el.y + el.points[i][1];
    if (Math.abs(sx - px) <= handleSize && Math.abs(sy - py) <= handleSize) {
      return i;
    }
  }
  return null;
}

export function getResizeHandleAtPoint(
  el: DrawElement,
  sx: number,
  sy: number,
  zoom: number,
): ResizeHandle | null {
  if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") return null;
  const handleSize = 8 / zoom;
  const handles = getResizeHandles(el, handleSize);
  for (const [name, [hx, hy]] of Object.entries(handles)) {
    if (Math.abs(sx - hx) <= handleSize && Math.abs(sy - hy) <= handleSize) {
      return name as ResizeHandle;
    }
  }
  return null;
}

function getResizeHandles(el: DrawElement, hs: number): Record<ResizeHandle, [number, number]> {
  const x1 = Math.min(el.x, el.x + el.width);
  const y1 = Math.min(el.y, el.y + el.height);
  const x2 = Math.max(el.x, el.x + el.width);
  const y2 = Math.max(el.y, el.y + el.height);
  const w = x2 - x1;
  const h = y2 - y1;
  return {
    nw: [x1, y1],
    ne: [x1 + w, y1],
    sw: [x1, y1 + h],
    se: [x1 + w, y1 + h],
    n: [x1 + w / 2, y1],
    s: [x1 + w / 2, y1 + h],
    w: [x1, y1 + h / 2],
    e: [x1 + w, y1 + h / 2],
  };
}

/** Hit-test Bezier handle control points; returns segment + cp index or null */
export function getHandleAtPoint(
  el: DrawElement, sx: number, sy: number, zoom: number,
): { segIndex: number; cpIndex: 0 | 1 } | null {
  if (!el.handles || !el.points || el.points.length < 3) return null;
  if (el.arrowType !== "round") return null;
  const handleSize = 10 / zoom;
  for (let i = 0; i < el.handles.length; i++) {
    const h = el.handles[i];
    if (Math.abs(sx - (el.x + h[0])) <= handleSize && Math.abs(sy - (el.y + h[1])) <= handleSize) {
      return { segIndex: i, cpIndex: 0 };
    }
    if (Math.abs(sx - (el.x + h[2])) <= handleSize && Math.abs(sy - (el.y + h[3])) <= handleSize) {
      return { segIndex: i, cpIndex: 1 };
    }
  }
  return null;
}

/** Hit-test midpoint handles; returns segment index or null */
export function getMidpointAtPoint(
  el: DrawElement, sx: number, sy: number, zoom: number,
): number | null {
  if (!el.points || el.points.length < 2) return null;
  if (el.type !== "line" && el.type !== "arrow") return null;
  const handleSize = 8 / zoom;
  for (let i = 0; i < el.points.length - 1; i++) {
    const [mx, my] = getSegmentMidpoint(el, i);
    const px = el.x + mx;
    const py = el.y + my;
    if (Math.abs(sx - px) <= handleSize && Math.abs(sy - py) <= handleSize) {
      return i;
    }
  }
  return null;
}

export function getElementsInSelectionBox(
  elements: DrawElement[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): DrawElement[] {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return elements.filter((el) => {
    if (el.isDeleted) return false;
    const [ex1, ey1, ex2, ey2] = getElementBounds(el);
    return ex1 >= left && ey1 >= top && ex2 <= right && ey2 <= bottom;
  });
}

export function getElementCenter(el: DrawElement): [number, number] {
  if ((el.type === "line" || el.type === "arrow" || el.type === "freedraw") && el.points && el.points.length > 0) {
    const [x1, y1, x2, y2] = getElementBounds(el);
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }
  return [el.x + el.width / 2, el.y + el.height / 2];
}

export function getElementBounds(el: DrawElement): [number, number, number, number] {
  if ((el.type === "freedraw" || el.type === "line" || el.type === "arrow") && el.points && el.points.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of el.points) {
      const px = el.x + p[0], py = el.y + p[1];
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    return [minX, minY, maxX, maxY];
  }
  const x1 = Math.min(el.x, el.x + el.width);
  const y1 = Math.min(el.y, el.y + el.height);
  const x2 = Math.max(el.x, el.x + el.width);
  const y2 = Math.max(el.y, el.y + el.height);
  return [x1, y1, x2, y2];
}

export function getResizeHandleCursor(handle: ResizeHandle): string {
  const cursors: Record<ResizeHandle, string> = {
    nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize",
    n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize",
  };
  return cursors[handle];
}
