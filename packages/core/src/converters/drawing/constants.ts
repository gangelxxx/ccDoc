// --- Type mappings ---

export const TYPE_TO_DSL: Record<string, string> = {
  rectangle: "rect",
  ellipse: "ellipse",
  diamond: "diamond",
  text: "text",
};

export const DSL_TO_TYPE: Record<string, string> = {
  rect: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  text: "text",
};

export const DEFAULT_SIZES: Record<string, [number, number]> = {
  rect: [200, 80],
  ellipse: [160, 80],
  diamond: [140, 100],
  text: [200, 40],
};

export const PADDING_X = 40;
export const PADDING_Y = 20;
export const CHAR_WIDTH = 10;
export const LINE_HEIGHT = 28;

export const DEFAULT_STROKE = "#1a1a1a";
export const DEFAULT_BG = "transparent";
export const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "text"]);
export const ARROW_TYPES = new Set(["arrow", "line"]);

// Auto-fill palette for shapes without explicit fill color (dark-theme-friendly)
export const AUTO_FILL_PALETTE = [
  "#264d35", "#6b3040", "#2e4a6e", "#6e5c1e", "#1e5e5e", "#553772",
];
export const AUTO_STROKE_LIGHT = "#e0e0e0";

// Regex patterns for DSL parsing
export const SHAPE_RE = /^-\s+\[?(rect|ellipse|diamond|text)\]?\s+"(.+?)"(?:\s+at\s+(\d+),(\d+))?(?:\s+size\s+(\d+)x(\d+))?(.*)?$/;
export const ARROW_RE = /^-\s+"(.+?)"\s+(-->|<-->|---)\s+"(.+?)"\s*(.*)$/;
export const PROP_RE = /^(\w[\w.-]*)\s*:\s*(.+)$/;
