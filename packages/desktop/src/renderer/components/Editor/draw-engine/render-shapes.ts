// Individual element renderers: shapes, lines, text, images

import type { DrawElement } from "./types.js";
import { getCurveControlPoints, shouldUseCurves } from "./curves.js";
import {
  FONT_FAMILIES, applyStrokeStyle, applyShadow, clearShadow,
  wrapText, roundedRectPath, getOrLoadImage,
} from "./render-helpers.js";
import { drawArrowhead, getArrowAngle } from "./render-arrows.js";

export function renderBoundText(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark") {
  if (!el.boundText) return;
  const fontSize = el.boundTextFontSize || 16;
  const family = FONT_FAMILIES[el.fontFamily || "hand"] || FONT_FAMILIES.hand;
  ctx.font = `${fontSize}px ${family}`;
  ctx.fillStyle = el.strokeColor || (theme === "dark" ? "#ffffff" : "#1a1a1a");
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const maxWidth = Math.abs(el.width) * 0.85;
  const lines = wrapText(ctx, el.boundText, maxWidth);
  const lineHeight = fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = cy - totalHeight / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, startY + i * lineHeight);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

export function renderRect(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark", editingBoundTextId?: string | null) {
  applyStrokeStyle(ctx, el, theme);
  applyShadow(ctx, theme);
  const r = el.roundness === "round" ? Math.min(Math.abs(el.width), Math.abs(el.height)) * 0.1 : 0;
  if (r > 0) {
    const path = roundedRectPath(el.x, el.y, el.width, el.height, r);
    if (el.backgroundColor && el.backgroundColor !== "transparent") {
      ctx.fillStyle = el.backgroundColor;
      ctx.fill(path);
    }
    ctx.stroke(path);
  } else {
    if (el.backgroundColor && el.backgroundColor !== "transparent") {
      ctx.fillStyle = el.backgroundColor;
      ctx.fillRect(el.x, el.y, el.width, el.height);
    }
    ctx.strokeRect(el.x, el.y, el.width, el.height);
  }
  clearShadow(ctx);
  if (el.id !== editingBoundTextId) renderBoundText(ctx, el, theme);
}

export function renderEllipse(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark", editingBoundTextId?: string | null) {
  applyStrokeStyle(ctx, el, theme);
  applyShadow(ctx, theme);
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(el.width) / 2, Math.abs(el.height) / 2, 0, 0, Math.PI * 2);
  if (el.backgroundColor && el.backgroundColor !== "transparent") {
    ctx.fillStyle = el.backgroundColor;
    ctx.fill();
  }
  ctx.stroke();
  clearShadow(ctx);
  if (el.id !== editingBoundTextId) renderBoundText(ctx, el, theme);
}

export function renderDiamond(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark", editingBoundTextId?: string | null) {
  applyStrokeStyle(ctx, el, theme);
  applyShadow(ctx, theme);
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ctx.beginPath();
  ctx.moveTo(cx, el.y);
  ctx.lineTo(el.x + el.width, cy);
  ctx.lineTo(cx, el.y + el.height);
  ctx.lineTo(el.x, cy);
  ctx.closePath();
  if (el.backgroundColor && el.backgroundColor !== "transparent") {
    ctx.fillStyle = el.backgroundColor;
    ctx.fill();
  }
  ctx.stroke();
  clearShadow(ctx);
  if (el.id !== editingBoundTextId) renderBoundText(ctx, el, theme);
}

export function renderLine(ctx: CanvasRenderingContext2D, el: DrawElement, theme?: "light" | "dark") {
  applyStrokeStyle(ctx, el, theme);
  if (el.points && el.points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);

    if (el.arrowType === "elbow") {
      // Straight segments between all points, no curves
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
      }
    } else if (shouldUseCurves(el)) {
      for (let i = 0; i < el.points.length - 1; i++) {
        const { cp1, cp2 } = getCurveControlPoints(el.points, i, el.handles);
        const p2 = el.points[i + 1];
        ctx.bezierCurveTo(
          el.x + cp1[0], el.y + cp1[1],
          el.x + cp2[0], el.y + cp2[1],
          el.x + p2[0], el.y + p2[1],
        );
      }
    } else {
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
      }
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x + el.width, el.y + el.height);
    ctx.stroke();
  }
}

export function renderArrow(ctx: CanvasRenderingContext2D, el: DrawElement, theme?: "light" | "dark") {
  renderLine(ctx, el, theme);
  // End arrowhead
  if (el.arrowhead === "arrow") {
    const endX = el.points ? el.x + el.points[el.points.length - 1][0] : el.x + el.width;
    const endY = el.points ? el.y + el.points[el.points.length - 1][1] : el.y + el.height;
    drawArrowhead(ctx, el, endX, endY, getArrowAngle(el, true));
  }
  // Start arrowhead
  if (el.startArrowhead === "arrow") {
    const startX = el.points ? el.x + el.points[0][0] : el.x;
    const startY = el.points ? el.y + el.points[0][1] : el.y;
    drawArrowhead(ctx, el, startX, startY, getArrowAngle(el, false));
  }
}

export function renderFreedraw(ctx: CanvasRenderingContext2D, el: DrawElement, theme?: "light" | "dark") {
  if (!el.points || el.points.length < 2) return;
  applyStrokeStyle(ctx, el, theme);
  ctx.beginPath();
  ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);
  // Smoothing via quadratic bezier
  for (let i = 1; i < el.points.length - 1; i++) {
    const [cx, cy] = el.points[i];
    const [nx, ny] = el.points[i + 1];
    const midX = (cx + nx) / 2;
    const midY = (cy + ny) / 2;
    ctx.quadraticCurveTo(el.x + cx, el.y + cy, el.x + midX, el.y + midY);
  }
  const last = el.points[el.points.length - 1];
  ctx.lineTo(el.x + last[0], el.y + last[1]);
  ctx.stroke();
}

export function renderText(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark") {
  if (!el.text) return;
  const fontSize = el.fontSize || 20;
  const family = FONT_FAMILIES[el.fontFamily || "hand"] || FONT_FAMILIES.hand;
  ctx.font = `${fontSize}px ${family}`;
  ctx.fillStyle = el.strokeColor || (theme === "dark" ? "#ffffff" : "#1a1a1a");
  ctx.textBaseline = "top";
  const align = el.textAlign || "left";
  ctx.textAlign = align;
  const x1 = Math.min(el.x, el.x + el.width);
  const w = Math.abs(el.width) || Infinity;
  const lines = wrapText(ctx, el.text, w);
  const y1 = Math.min(el.y, el.y + el.height);
  const h = Math.abs(el.height);
  for (let i = 0; i < lines.length; i++) {
    const ly = y1 + i * fontSize * 1.2;
    if (ly + fontSize > y1 + h) break; // clip to element bounds
    const tx = align === "center" ? x1 + w / 2 : align === "right" ? x1 + w : x1;
    ctx.fillText(lines[i], tx, ly);
  }
  ctx.textAlign = "left";
}

export function renderImage(ctx: CanvasRenderingContext2D, el: DrawElement, theme: "light" | "dark") {
  if (!el.imageData) return;
  const img = getOrLoadImage(el.imageData);
  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  const tx = el.width < 0 ? el.x + el.width : el.x;
  const ty = el.height < 0 ? el.y + el.height : el.y;

  if (img) {
    // Preserve aspect ratio inside element bounds
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const elAspect = w / h;
    let dw: number, dh: number, dx: number, dy: number;
    if (imgAspect > elAspect) {
      dw = w;
      dh = w / imgAspect;
      dx = tx;
      dy = ty + (h - dh) / 2;
    } else {
      dh = h;
      dw = h * imgAspect;
      dx = tx + (w - dw) / 2;
      dy = ty;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    // Placeholder while loading
    ctx.strokeStyle = theme === "dark" ? "#555" : "#ccc";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(tx, ty, w, h);
    ctx.setLineDash([]);
  }

  // Border
  applyStrokeStyle(ctx, el, theme);
  ctx.strokeRect(tx, ty, w, h);
}
