import type { KGNode, KGEdge } from "@ccdoc/core";

export interface SimNode extends KGNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface SimEdge extends KGEdge {
  source: string | SimNode;
  target: string | SimNode;
}

export type NodeColors = Record<string, string>;

export const DEFAULT_NODE_COLORS: NodeColors = {
  idea: "#B8B0F0",
  doc: "#7EB8E8",
  section: "#6DCAAA",
  session: "#E8A96E",
};

/** Convert hex color to soft translucent edge color */
export function toEdgeColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.5)`;
}
