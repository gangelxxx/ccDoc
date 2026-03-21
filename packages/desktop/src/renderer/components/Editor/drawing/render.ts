// Main render module: scene rendering, element dispatch, selection, grid

import type { DrawElement, DrawState } from "./types.js";
import { getSegmentMidpoint } from "./curves.js";
import { getElementBounds } from "./hit-testing.js";
import {
  renderRect, renderEllipse, renderDiamond, renderLine,
  renderArrow, renderFreedraw, renderText, renderImage,
} from "./render-shapes.js";

// Re-export helpers and arrows so that index.ts exports remain unchanged
export { FONT_FAMILIES, DARK_STROKE_SET, applyStrokeStyle, applyShadow, clearShadow, wrapText, roundedRectPath } from "./render-helpers.js";
export { drawArrowhead, getArrowAngle } from "./render-arrows.js";

// --- Element dispatcher ---

function renderElement(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark", editingBoundTextId?: string | null) {
  switch (el.type) {
    case "rectangle":
      renderRect(ctx, el, theme, editingBoundTextId);
      break;
    case "ellipse":
      renderEllipse(ctx, el, theme, editingBoundTextId);
      break;
    case "diamond":
      renderDiamond(ctx, el, theme, editingBoundTextId);
      break;
    case "line":
      renderLine(ctx, el, theme);
      break;
    case "arrow":
      renderArrow(ctx, el, theme);
      break;
    case "freedraw":
      renderFreedraw(ctx, el, theme);
      break;
    case "text":
      if (el.id !== editingBoundTextId) renderText(ctx, el, theme);
      break;
    case "image":
      renderImage(ctx, el, theme);
      break;
  }
}

// --- Selection rendering ---

function renderSelectionBox(ctx: CanvasRenderingContext2D, el: DrawElement, zoom: number) {
  const pad = 4 / zoom;
  const handleSize = 6 / zoom;
  const [bx1, by1, bx2, by2] = getElementBounds(el);
  const bw = bx2 - bx1;
  const bh = by2 - by1;

  // Dashed outline
  ctx.save();
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(bx1 - pad, by1 - pad, bw + pad * 2, bh + pad * 2);
  ctx.setLineDash([]);

  // Resize handles (not for line/arrow/freedraw)
  if (el.type !== "line" && el.type !== "arrow" && el.type !== "freedraw") {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 1.5 / zoom;
  const cx = bx1 + bw / 2, cy = by1 + bh / 2;
  const pts: [number, number][] = [
    [bx1, by1], [cx, by1], [bx2, by1],
    [bx1, cy], [bx2, cy],
    [bx1, by2], [cx, by2], [bx2, by2],
  ];
  for (const [hx, hy] of pts) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }
  }

  // Endpoint handles for line/arrow
  if ((el.type === "line" || el.type === "arrow") && el.points && el.points.length >= 2) {
    const r = handleSize * 0.7;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#4a90d9";
    ctx.lineWidth = 1.5 / zoom;
    for (const p of el.points) {
      const px = el.x + p[0];
      const py = el.y + p[1];
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Midpoint handles (phantom points for inserting new control points)
    const mr = handleSize * 0.5;
    for (let i = 0; i < el.points.length - 1; i++) {
      const [mx, my] = getSegmentMidpoint(el, i);
      const px = el.x + mx;
      const py = el.y + my;
      ctx.beginPath();
      ctx.arc(px, py, mr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74, 144, 217, 0.3)";
      ctx.fill();
      ctx.strokeStyle = "#4a90d9";
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
  }

  ctx.restore();
}

// --- Grid rendering ---

function renderGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  gridSize: number,
  zoom: number,
  scrollX: number,
  scrollY: number,
  theme: "light" | "dark",
) {
  ctx.save();
  ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;
  const step = gridSize * zoom;
  if (step < 1) { ctx.restore(); return; }
  const offsetX = ((scrollX % step) + step) % step;
  const offsetY = ((scrollY % step) + step) % step;
  ctx.beginPath();
  for (let x = offsetX; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = offsetY; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();
}

// --- Main scene renderer ---

export function renderScene(
  ctx: CanvasRenderingContext2D,
  state: DrawState,
  canvasWidth: number,
  canvasHeight: number,
  selectedIds: Set<string>,
  theme: "light" | "dark",
  editingBoundTextId?: string | null,
) {
  const { elements, appState } = state;
  const { zoom, scrollX, scrollY } = appState;

  // Clear & Background
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvasWidth * dpr, canvasHeight * dpr);
  ctx.restore();

  const bgColor = theme === "dark" ? "#1e1e1e" : appState.viewBackgroundColor;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Grid
  if (appState.gridSize) {
    renderGrid(ctx, canvasWidth, canvasHeight, appState.gridSize, zoom, scrollX, scrollY, theme);
  }

  ctx.save();
  ctx.translate(scrollX, scrollY);
  ctx.scale(zoom, zoom);

  // Elements
  for (const el of elements) {
    if (el.isDeleted) continue;
    ctx.save();
    ctx.globalAlpha = el.opacity / 100;
    renderElement(ctx, el, theme, editingBoundTextId);
    ctx.restore();
  }

  // Selection outlines
  for (const el of elements) {
    if (el.isDeleted || !selectedIds.has(el.id)) continue;
    renderSelectionBox(ctx, el, zoom);
  }

  ctx.restore();
}

export function renderSelectionRect(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  zoom: number, scrollX: number, scrollY: number,
) {
  ctx.save();
  ctx.translate(scrollX, scrollY);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = "rgba(74, 144, 217, 0.08)";
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Render a highlight around a bind target element */
export function renderBindHighlight(
  ctx: CanvasRenderingContext2D,
  el: DrawElement,
  zoom: number,
) {
  const [bx1, by1, bx2, by2] = getElementBounds(el);
  const pad = 6 / zoom;
  ctx.save();
  ctx.strokeStyle = "#1971c2";
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.6;
  const r = 4 / zoom;
  const x = bx1 - pad, y = by1 - pad, w = bx2 - bx1 + pad * 2, h = by2 - by1 + pad * 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
