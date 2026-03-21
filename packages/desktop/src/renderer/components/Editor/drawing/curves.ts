// Catmull-Rom to cubic Bezier conversion and curve utilities

import type { DrawElement } from "./types.js";

export function catmullRomToBezier(
  p0: [number, number], p1: [number, number],
  p2: [number, number], p3: [number, number],
  tension = 0.5,
): { cp1: [number, number]; cp2: [number, number] } {
  const t = tension;
  return {
    cp1: [
      p1[0] + (p2[0] - p0[0]) / (6 / t),
      p1[1] + (p2[1] - p0[1]) / (6 / t),
    ],
    cp2: [
      p2[0] - (p3[0] - p1[0]) / (6 / t),
      p2[1] - (p3[1] - p1[1]) / (6 / t),
    ],
  };
}

export function shouldUseCurves(el: DrawElement): boolean {
  if (!el.points || el.points.length < 2) return false;
  // Sharp arrows are always straight segments
  if (el.arrowType === "sharp") return false;
  // Use curves if we have explicit handles (even for 2-point lines)
  if (el.handles && el.handles.length > 0) return true;
  // Auto Catmull-Rom curves need at least 3 points
  return (el.arrowType === "round" || el.type === "line") && el.points.length >= 3;
}

export function getCurveControlPoints(
  points: [number, number][], segIndex: number,
  handles?: [number, number, number, number][],
): { cp1: [number, number]; cp2: [number, number] } {
  if (handles && handles[segIndex]) {
    const h = handles[segIndex];
    return { cp1: [h[0], h[1]], cp2: [h[2], h[3]] };
  }
  const p1 = points[segIndex];
  const p2 = points[segIndex + 1];
  const p0 = segIndex > 0 ? points[segIndex - 1] : p1;
  const p3 = segIndex + 2 < points.length ? points[segIndex + 2] : p2;
  return catmullRomToBezier(p0, p1, p2, p3);
}

/** Initialize Bezier handles from Catmull-Rom for all segments */
export function initHandlesFromCatmullRom(points: [number, number][]): [number, number, number, number][] {
  const handles: [number, number, number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const { cp1, cp2 } = getCurveControlPoints(points, i);
    handles.push([cp1[0], cp1[1], cp2[0], cp2[1]]);
  }
  return handles;
}

/** Get visual midpoint of segment i (straight or curved) */
export function getSegmentMidpoint(el: DrawElement, segIndex: number): [number, number] {
  if (!el.points || segIndex < 0 || segIndex >= el.points.length - 1) return [0, 0];
  const pts = el.points;
  const p1 = pts[segIndex];
  const p2 = pts[segIndex + 1];

  if (shouldUseCurves(el)) {
    const { cp1, cp2 } = getCurveControlPoints(pts, segIndex, el.handles);
    // Evaluate cubic Bezier at t=0.5
    const t = 0.5;
    const mt = 1 - t;
    return [
      mt * mt * mt * p1[0] + 3 * mt * mt * t * cp1[0] + 3 * mt * t * t * cp2[0] + t * t * t * p2[0],
      mt * mt * mt * p1[1] + 3 * mt * mt * t * cp1[1] + 3 * mt * t * t * cp2[1] + t * t * t * p2[1],
    ];
  }
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}
