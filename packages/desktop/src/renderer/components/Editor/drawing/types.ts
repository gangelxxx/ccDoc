// Drawing engine types and interfaces

export type ToolType = "selection" | "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "freedraw" | "text" | "image";

export interface DrawElement {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  opacity: number;
  seed: number;
  isDeleted: boolean;
  // freedraw
  points?: [number, number][];
  // text
  text?: string;
  fontSize?: number;
  // arrow
  arrowhead?: "arrow" | null;
  // bindings (line/arrow endpoints → shape)
  startBinding?: { elementId: string; anchorX: number; anchorY: number } | null;
  endBinding?: { elementId: string; anchorX: number; anchorY: number } | null;
  // text extras
  fontFamily?: "hand" | "normal" | "code" | "headline";
  textAlign?: "left" | "center" | "right";
  // shape extras
  roundness?: "sharp" | "round";
  strokeLineStyle?: "round" | "sharp" | "architect";
  arrowType?: "sharp" | "round" | "elbow";
  startArrowhead?: "arrow" | null;
  // Bezier handles: [cp1x, cp1y, cp2x, cp2y] per segment (points.length - 1 entries)
  // Coordinates relative to el.x/el.y, like points
  handles?: [number, number, number, number][];
  // bound text (text inside shapes)
  boundText?: string;
  boundTextFontSize?: number;
  // image
  imageData?: string;
}

export interface DrawState {
  elements: DrawElement[];
  appState: {
    viewBackgroundColor: string;
    gridSize: number | null;
    zoom: number;
    scrollX: number;
    scrollY: number;
  };
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
