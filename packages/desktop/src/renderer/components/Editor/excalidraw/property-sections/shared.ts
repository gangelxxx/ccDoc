import type { DrawElement } from "../../drawing-engine.js";

export const STROKE_COLORS = ["#1a1a1a", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#7048e8", "#0d7c66", "#ffffff"];
export const BG_COLORS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff", "#96f2d7"];

export interface SectionProps {
  firstEl: DrawElement | null;
  updateSelectedProps: (updates: Partial<DrawElement>) => void;
}
