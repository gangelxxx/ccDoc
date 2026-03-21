import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { ExcalidrawElement } from "../../types.js";
import {
  DSL_TO_TYPE,
  DEFAULT_SIZES,
  DEFAULT_STROKE,
  DEFAULT_BG,
  SHAPE_TYPES,
  AUTO_FILL_PALETTE,
  AUTO_STROKE_LIGHT,
  SHAPE_RE,
  ARROW_RE,
  PROP_RE,
} from "./constants.js";
import {
  estimateTextSize,
  isShape,
  getLabel,
  centerOf,
  makeId,
  makeSeed,
  edgeAnchor,
} from "./helpers.js";

type PendingShape = {
  dslType: string;
  label: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  props: Record<string, string>;
};

type PendingArrow = {
  source: string;
  target: string;
  connector: string;
  props: Record<string, string>;
};

export async function textToExcalidraw(
  text: string,
  existingElements?: ExcalidrawElement[],
): Promise<{ elements: ExcalidrawElement[] }> {
  const existingMap = new Map<string, ExcalidrawElement>();
  if (existingElements) {
    for (const el of existingElements) {
      const label = getLabel(el).toLowerCase();
      if (label) existingMap.set(label, el);
    }
  }

  const pendingShapes: PendingShape[] = [];
  const pendingArrows: PendingArrow[] = [];
  let currentItem: PendingShape | PendingArrow | null = null;
  let counter = 0;
  let layoutDirection: "TB" | "LR" | "BT" | "RL" = "TB";

  const LAYOUT_RE = /^(?:direction|type)\s*:\s*(top-down|left-right|bottom-up|right-left|TB|LR|BT|RL)\s*$/i;
  const LAYOUT_MAP: Record<string, "TB" | "LR" | "BT" | "RL"> = {
    "top-down": "TB", "tb": "TB",
    "left-right": "LR", "lr": "LR",
    "bottom-up": "BT", "bt": "BT",
    "right-left": "RL", "rl": "RL",
  };

  // Rejoin lines broken by literal newlines inside quoted labels.
  // A continuation line is one that doesn't start a new DSL item (- [...], ##, or indented prop).
  const rawLines = text.split("\n");
  const joinedLines: string[] = [];
  for (const raw of rawLines) {
    const t = raw.trim();
    if (t.startsWith("- ") || t.startsWith("##") || !t || (raw.startsWith("  ") && joinedLines.length > 0)) {
      joinedLines.push(raw);
    } else if (joinedLines.length > 0) {
      // Continuation of previous line — rejoin with \n marker
      joinedLines[joinedLines.length - 1] += "\\n" + raw;
    } else {
      joinedLines.push(raw);
    }
  }

  for (const line of joinedLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("##")) {
      continue;
    }

    const layoutMatch = trimmed.match(LAYOUT_RE);
    if (layoutMatch) {
      layoutDirection = LAYOUT_MAP[layoutMatch[1].toLowerCase()] ?? "TB";
      continue;
    }

    const shapeMatch = trimmed.match(SHAPE_RE);
    if (shapeMatch) {
      const shape: PendingShape = {
        dslType: shapeMatch[1],
        label: shapeMatch[2],
        x: shapeMatch[3] != null ? parseInt(shapeMatch[3]) : null,
        y: shapeMatch[4] != null ? parseInt(shapeMatch[4]) : null,
        w: shapeMatch[5] != null ? parseInt(shapeMatch[5]) : null,
        h: shapeMatch[6] != null ? parseInt(shapeMatch[6]) : null,
        props: {},
      };
      // Parse inline properties (e.g. "- [rect] "Label" fill: #fff, round")
      const inlineProps = (shapeMatch[7] ?? "").trim();
      if (inlineProps) {
        for (const segment of inlineProps.split(",").map((s) => s.trim())) {
          if (segment === "round" || segment === "sharp") {
            shape.props[segment] = "true";
          } else {
            const propMatch = segment.match(PROP_RE);
            if (propMatch) {
              shape.props[propMatch[1]] = propMatch[2].trim();
            }
          }
        }
      }
      pendingShapes.push(shape);
      currentItem = shape;
      continue;
    }

    const arrowMatch = trimmed.match(ARROW_RE);
    if (arrowMatch) {
      const arrow: PendingArrow = {
        source: arrowMatch[1],
        target: arrowMatch[3],
        connector: arrowMatch[2],
        props: {},
      };
      // Parse inline properties (e.g. "- "A" --> "B" label: text, style: dashed")
      const inlineProps = (arrowMatch[4] ?? "").trim();
      if (inlineProps) {
        for (const segment of inlineProps.split(",").map((s) => s.trim())) {
          const propMatch = segment.match(PROP_RE);
          if (propMatch) {
            arrow.props[propMatch[1]] = propMatch[2].trim();
          }
        }
      }
      pendingArrows.push(arrow);
      currentItem = arrow;
      continue;
    }

    if (line.startsWith("  ") && currentItem) {
      for (const segment of trimmed.split(",").map((s) => s.trim())) {
        if (segment === "round" || segment === "sharp") {
          currentItem.props[segment] = "true";
        } else {
          const propMatch = segment.match(PROP_RE);
          if (propMatch) {
            currentItem.props[propMatch[1]] = propMatch[2].trim();
          }
        }
      }
    }
  }

  // Auto-layout using ELK for shapes without explicit coordinates
  const shapesWithoutPos = pendingShapes.filter((s) => s.x === null);
  if (shapesWithoutPos.length > 0) {
    const ELK_DIR: Record<string, string> = { TB: "DOWN", LR: "RIGHT", BT: "UP", RL: "LEFT" };

    const elkChildren: ElkNode[] = [];
    const sizeMap = new Map<string, { w: number; h: number }>();

    for (const s of shapesWithoutPos) {
      const { minW, minH } = estimateTextSize(s.label);
      const defaults = DEFAULT_SIZES[s.dslType] ?? [200, 80];
      const w = s.w ?? Math.max(defaults[0], minW);
      const h = s.h ?? Math.max(defaults[1], minH);
      sizeMap.set(s.label.toLowerCase(), { w, h });
      elkChildren.push({ id: s.label.toLowerCase(), width: w, height: h });
    }

    const autoLabels = new Set(shapesWithoutPos.map((s) => s.label.toLowerCase()));
    const elkEdges = pendingArrows
      .filter((a) => autoLabels.has(a.source.toLowerCase()) && autoLabels.has(a.target.toLowerCase()))
      .map((a, i) => ({ id: `e${i}`, sources: [a.source.toLowerCase()], targets: [a.target.toLowerCase()] }));

    const elk = new ELK();
    const graph = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": ELK_DIR[layoutDirection] ?? "DOWN",
        "elk.spacing.nodeNode": "60",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.padding": "[top=40,left=40,bottom=40,right=40]",
        "elk.edgeRouting": "ORTHOGONAL",
      },
      children: elkChildren,
      edges: elkEdges,
    });

    for (const s of shapesWithoutPos) {
      const node = graph.children?.find((c) => c.id === s.label.toLowerCase());
      if (node && node.x != null && node.y != null) {
        s.x = Math.round(node.x);
        s.y = Math.round(node.y);
      }
    }
  }

  const elements: ExcalidrawElement[] = [];
  const labelToElement = new Map<string, ExcalidrawElement>();

  if (existingElements) {
    const preservedIds = new Set<string>();

    for (const s of pendingShapes) {
      const existing = existingMap.get(s.label.toLowerCase());
      if (existing) {
        const el = buildShapeFromPending(s, counter++, existing);
        elements.push(el);
        labelToElement.set(s.label.toLowerCase(), el);
        preservedIds.add(existing.id);
      } else {
        const el = buildShapeFromPending(s, counter++);
        elements.push(el);
        labelToElement.set(s.label.toLowerCase(), el);
      }
    }

    for (const ex of existingElements) {
      if (!preservedIds.has(ex.id) && !isShape(ex)) {
        elements.push(ex);
      }
      if (!preservedIds.has(ex.id) && isShape(ex)) {
        elements.push(ex);
        const label = getLabel(ex).toLowerCase();
        if (label && !labelToElement.has(label)) {
          labelToElement.set(label, ex);
        }
      }
    }
  } else {
    for (const s of pendingShapes) {
      const el = buildShapeFromPending(s, counter++);
      elements.push(el);
      labelToElement.set(s.label.toLowerCase(), el);
    }
  }

  for (const a of pendingArrows) {
    const el = buildArrow(a, counter++, labelToElement);
    elements.push(el);
  }

  // Auto-assign fill colors to shapes without explicit fill (non-text only)
  let colorIdx = 0;
  for (const el of elements) {
    if (
      SHAPE_TYPES.has(el.type) &&
      el.type !== "text" &&
      el.backgroundColor === DEFAULT_BG
    ) {
      el.backgroundColor = AUTO_FILL_PALETTE[colorIdx % AUTO_FILL_PALETTE.length];
      colorIdx++;
    }
    // Also fix stroke for dark-theme readability
    if (SHAPE_TYPES.has(el.type) && el.strokeColor === DEFAULT_STROKE) {
      el.strokeColor = AUTO_STROKE_LIGHT;
    }
  }

  return { elements };
}

function buildShapeFromPending(
  s: PendingShape,
  counter: number,
  existing?: ExcalidrawElement,
): ExcalidrawElement {
  const elType = DSL_TO_TYPE[s.dslType] ?? s.dslType;
  const defaults = DEFAULT_SIZES[s.dslType] ?? [200, 80];

  const useExistingPos = existing && s.x === null;
  const useExistingSize = existing && s.w === null;

  const el: ExcalidrawElement = {
    id: existing?.id ?? makeId(counter),
    type: elType,
    x: useExistingPos ? existing.x : (s.x ?? 100),
    y: useExistingPos ? existing.y : (s.y ?? 100),
    width: useExistingSize ? existing.width : (s.w ?? defaults[0]),
    height: useExistingSize ? existing.height : (s.h ?? defaults[1]),
    angle: 0,
    strokeColor: s.props["stroke"] ?? DEFAULT_STROKE,
    backgroundColor: s.props["fill"] ?? DEFAULT_BG,
    strokeWidth: s.props["width"] ? parseInt(s.props["width"]) : 2,
    strokeStyle: s.props["stroke-style"] ?? "solid",
    opacity: s.props["opacity"] ? parseInt(s.props["opacity"]) : 100,
    seed: existing?.seed ?? makeSeed(),
    isDeleted: false,
    roundness: s.props["round"] ? "round" : s.props["sharp"] ? undefined : (existing?.roundness ?? undefined),
  };

  const resolvedLabel = s.label.replace(/\\n/g, "\n");
  if (elType === "text") {
    el.text = resolvedLabel;
    if (s.props["font"]) el.fontFamily = s.props["font"];
    if (s.props["size"]) el.fontSize = parseInt(s.props["size"]);
    if (s.props["align"]) el.textAlign = s.props["align"];
    // Auto-expand text element to fit content
    const { minW, minH } = estimateTextSize(resolvedLabel, el.fontSize ?? 20);
    if (el.width < minW) el.width = minW;
    if (el.height < minH) el.height = minH;
  } else {
    el.boundText = resolvedLabel;
    if (s.props["bound-font"]) el.boundTextFontSize = parseInt(s.props["bound-font"]);
    // Auto-expand shape to fit its label text
    const fontSize = el.boundTextFontSize ?? 16;
    const { minW, minH } = estimateTextSize(resolvedLabel, fontSize);
    if (el.width < minW) el.width = minW;
    if (el.height < minH) el.height = minH;
  }

  return el;
}

function buildArrow(
  a: PendingArrow,
  counter: number,
  labelToElement: Map<string, ExcalidrawElement>,
): ExcalidrawElement {
  const sourceEl = labelToElement.get(a.source.toLowerCase());
  const targetEl = labelToElement.get(a.target.toLowerCase());

  const srcCenter: [number, number] = sourceEl ? centerOf(sourceEl) : [100, 100];
  const tgtCenter: [number, number] = targetEl ? centerOf(targetEl) : [300, 100];

  const srcEdge = sourceEl ? edgeAnchor(sourceEl, tgtCenter) : { anchor: [0.5, 0.5] as [number, number], point: srcCenter };
  const tgtEdge = targetEl ? edgeAnchor(targetEl, srcCenter) : { anchor: [0.5, 0.5] as [number, number], point: tgtCenter };

  const startPt = srcEdge.point;
  const endPt = tgtEdge.point;
  const dx = endPt[0] - startPt[0];
  const dy = endPt[1] - startPt[1];

  let arrowhead: string | null = null;
  let startArrowhead: string | null = null;

  if (a.connector === "-->") {
    arrowhead = "arrow";
  } else if (a.connector === "<-->") {
    arrowhead = "arrow";
    startArrowhead = "arrow";
  }

  const el: ExcalidrawElement = {
    id: makeId(counter),
    type: "arrow",
    x: startPt[0],
    y: startPt[1],
    width: Math.abs(dx),
    height: Math.abs(dy),
    angle: 0,
    strokeColor: a.props["stroke"] ?? DEFAULT_STROKE,
    backgroundColor: DEFAULT_BG,
    strokeWidth: a.props["width"] ? parseInt(a.props["width"]) : 2,
    strokeStyle: a.props["style"] ?? "solid",
    opacity: a.props["opacity"] ? parseInt(a.props["opacity"]) : 100,
    seed: makeSeed(),
    isDeleted: false,
    points: [[0, 0], [dx, dy]],
    arrowhead,
    startArrowhead,
    arrowType: a.props["arrowType"] ?? "round",
    startBinding: sourceEl
      ? { elementId: sourceEl.id, anchorX: srcEdge.anchor[0], anchorY: srcEdge.anchor[1] }
      : null,
    endBinding: targetEl
      ? { elementId: targetEl.id, anchorX: tgtEdge.anchor[0], anchorY: tgtEdge.anchor[1] }
      : null,
  };

  if (a.props["label"]) {
    el.boundText = a.props["label"].replace(/\\n/g, "\n");
  }

  return el;
}
