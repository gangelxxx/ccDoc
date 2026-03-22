// Shared rendering helpers: constants, style application, text wrapping, path builders, image cache

import type { DrawElement } from "./types.js";

// --- Font families ---
export const FONT_FAMILIES: Record<string, string> = {
  hand: "'Segoe UI', sans-serif",
  normal: "Arial, Helvetica, sans-serif",
  code: "'Cascadia Code', 'Fira Code', monospace",
  headline: "Georgia, 'Times New Roman', serif",
};

// --- Dark stroke colors that should be inverted ---
export const DARK_STROKE_SET = new Set(["#1a1a1a", "#000000", "#1e1e1e", "#111111", "#0d0d0d", "#222222"]);

// --- Image cache for canvas rendering ---
const imageCache = new Map<string, HTMLImageElement>();

export function getOrLoadImage(dataUrl: string): HTMLImageElement | null {
  const cached = imageCache.get(dataUrl);
  if (cached && cached.complete) return cached;
  if (!cached) {
    const img = new Image();
    img.src = dataUrl;
    imageCache.set(dataUrl, img);
  }
  return null;
}

// --- Style helpers ---

export function applyStrokeStyle(ctx: CanvasRenderingContext2D, el: DrawElement, theme?: "light" | "dark") {
  ctx.strokeStyle = (theme === "dark" && DARK_STROKE_SET.has(el.strokeColor.toLowerCase()))
    ? "#e0e0e0"
    : el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (el.strokeStyle === "dashed") {
    ctx.setLineDash([8, 8]);
  } else if (el.strokeStyle === "dotted") {
    ctx.setLineDash([2, 4]);
  } else {
    ctx.setLineDash([]);
  }
}

export function applyShadow(ctx: CanvasRenderingContext2D, theme: "light" | "dark") {
  if (theme === "dark") {
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.15)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 4;
  }
}

export function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// --- Text wrapping ---

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  const breakWord = (word: string): string[] => {
    const parts: string[] = [];
    let cur = "";
    for (const ch of word) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur) {
        parts.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  };
  for (const paragraph of text.split("\n")) {
    if (!paragraph) { result.push(""); continue; }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (ctx.measureText(word).width > maxWidth) {
        if (line) { result.push(line); line = ""; }
        const parts = breakWord(word);
        for (let i = 0; i < parts.length - 1; i++) result.push(parts[i]);
        line = parts[parts.length - 1] || "";
        continue;
      }
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        result.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

// --- Path helpers ---

export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.arcTo(x + w, y, x + w, y + r, r);
  p.lineTo(x + w, y + h - r);
  p.arcTo(x + w, y + h, x + w - r, y + h, r);
  p.lineTo(x + r, y + h);
  p.arcTo(x, y + h, x, y + h - r, r);
  p.lineTo(x, y + r);
  p.arcTo(x, y, x + r, y, r);
  p.closePath();
  return p;
}
