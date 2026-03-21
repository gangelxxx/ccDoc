// Arrow rendering: arrowhead drawing and angle computation

import type { DrawElement } from "./types.js";
import { getCurveControlPoints, shouldUseCurves } from "./curves.js";

export function drawArrowhead(ctx: CanvasRenderingContext2D, el: DrawElement, tipX: number, tipY: number, angle: number) {
  const headLen = 10 + el.strokeWidth * 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - headLen * Math.cos(angle - Math.PI / 6),
    tipY - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - headLen * Math.cos(angle + Math.PI / 6),
    tipY - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
}

export function getArrowAngle(el: DrawElement, atEnd: boolean): number {
  if (!el.points || el.points.length < 2) {
    const dx = el.width, dy = el.height;
    return atEnd ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
  }
  // Elbow: use actual points for angle (straight segments, no computed routing)
  if (el.arrowType === "elbow") {
    if (atEnd) {
      const p1 = el.points[el.points.length - 2];
      const p2 = el.points[el.points.length - 1];
      return Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    } else {
      const p1 = el.points[1];
      const p2 = el.points[0];
      return Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    }
  }
  // Use Bezier tangent when we have handles (even for 2-point lines)
  const hasCurveHandles = el.handles && el.handles.length > 0;
  const useCurves = (shouldUseCurves(el) && el.points.length >= 3) || hasCurveHandles;
  if (useCurves) {
    if (atEnd) {
      const segIdx = el.points.length - 2;
      const { cp1, cp2 } = getCurveControlPoints(el.points, segIdx, el.handles);
      const last = el.points[el.points.length - 1];
      // Use point on curve near endpoint for visually accurate direction
      const p0 = el.points[segIdx];
      const t = 0.9;
      const u = 1 - t;
      const fromX = u*u*u*p0[0] + 3*u*u*t*cp1[0] + 3*u*t*t*cp2[0] + t*t*t*last[0];
      const fromY = u*u*u*p0[1] + 3*u*u*t*cp1[1] + 3*u*t*t*cp2[1] + t*t*t*last[1];
      return Math.atan2(last[1] - fromY, last[0] - fromX);
    } else {
      const { cp1, cp2 } = getCurveControlPoints(el.points, 0, el.handles);
      const first = el.points[0];
      const p3 = el.points[1];
      // Use point on curve near start for visually accurate direction
      const t = 0.1;
      const u = 1 - t;
      const fromX = u*u*u*first[0] + 3*u*u*t*cp1[0] + 3*u*t*t*cp2[0] + t*t*t*p3[0];
      const fromY = u*u*u*first[1] + 3*u*u*t*cp1[1] + 3*u*t*t*cp2[1] + t*t*t*p3[1];
      return Math.atan2(first[1] - fromY, first[0] - fromX);
    }
  }
  if (atEnd) {
    const p1 = el.points[el.points.length - 2];
    const p2 = el.points[el.points.length - 1];
    return Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  } else {
    const p1 = el.points[1];
    const p2 = el.points[0];
    return Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  }
}
