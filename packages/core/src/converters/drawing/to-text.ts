import type { DrawingElement } from "../../types.js";
import { TYPE_TO_DSL, DEFAULT_STROKE, DEFAULT_BG } from "./constants.js";
import {
  isShape,
  isArrow,
  getLabel,
  buildElementMap,
  resolveBindingLabel,
  coordLabel,
} from "./helpers.js";

export function drawingToText(elements: DrawingElement[]): string {
  const elMap = buildElementMap(elements);
  const shapes = elements.filter(isShape);
  const arrows = elements.filter(isArrow);

  let shapeCounter = 0;
  const labelMap = new Map<string, string>();

  for (const el of shapes) {
    let label = getLabel(el);
    if (!label) {
      shapeCounter++;
      label = `Shape ${shapeCounter}`;
    }
    labelMap.set(el.id, label);
  }

  const lines: string[] = [];

  if (shapes.length > 0) {
    lines.push("## Shapes");
    for (const el of shapes) {
      const dslType = TYPE_TO_DSL[el.type] ?? el.type;
      const label = labelMap.get(el.id) ?? "";
      const w = Math.round(el.width);
      const h = Math.round(el.height);
      const x = Math.round(el.x);
      const y = Math.round(el.y);

      const shapeLine = `- [${dslType}] "${label}" at ${x},${y} size ${w}x${h}`;

      if (el.type === "text") {
        lines.push(shapeLine);
        const props: string[] = [];
        if (el.fontFamily && el.fontFamily !== "normal") props.push(`font: ${el.fontFamily}`);
        if (el.fontSize && el.fontSize !== 20) props.push(`size: ${el.fontSize}`);
        if (el.textAlign && el.textAlign !== "left") props.push(`align: ${el.textAlign}`);
        if (el.strokeWidth && el.strokeWidth !== 2) props.push(`width: ${el.strokeWidth}`);
        if (el.opacity != null && el.opacity !== 100) props.push(`opacity: ${el.opacity}`);
        if (props.length > 0) lines.push(`  ${props.join(", ")}`);
      } else {
        lines.push(shapeLine);
        const props: string[] = [];
        if (el.backgroundColor && el.backgroundColor !== DEFAULT_BG) props.push(`fill: ${el.backgroundColor}`);
        if (el.strokeColor && el.strokeColor !== DEFAULT_STROKE) props.push(`stroke: ${el.strokeColor}`);
        if (el.roundness) props.push("round");
        if (el.strokeStyle && el.strokeStyle !== "solid") props.push(`stroke-style: ${el.strokeStyle}`);
        if (el.strokeWidth && el.strokeWidth !== 2) props.push(`width: ${el.strokeWidth}`);
        if (el.opacity != null && el.opacity !== 100) props.push(`opacity: ${el.opacity}`);
        if (el.boundTextFontSize && el.boundTextFontSize !== 16) props.push(`bound-font: ${el.boundTextFontSize}`);
        if (props.length > 0) lines.push(`  ${props.join(", ")}`);
      }
    }
  }

  if (arrows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Arrows");
    for (const el of arrows) {
      const startLabel = resolveBindingLabel(el.startBinding, elMap, labelMap);
      const endLabel = resolveBindingLabel(el.endBinding, elMap, labelMap);

      let connector: string;
      if (el.type === "line" || (!el.arrowhead && !el.startArrowhead)) {
        connector = "---";
      } else if (el.startArrowhead && el.arrowhead) {
        connector = "<-->";
      } else {
        connector = "-->";
      }

      const source = startLabel ?? coordLabel(el, "start");
      const target = endLabel ?? coordLabel(el, "end");

      lines.push(`- "${source}" ${connector} "${target}"`);

      const props: string[] = [];
      if (el.boundText) props.push(`label: ${el.boundText}`);
      if (el.strokeStyle && el.strokeStyle !== "solid") props.push(`style: ${el.strokeStyle}`);
      if (el.strokeColor && el.strokeColor !== DEFAULT_STROKE) props.push(`stroke: ${el.strokeColor}`);
      if (el.strokeWidth && el.strokeWidth !== 2) props.push(`width: ${el.strokeWidth}`);
      if (el.opacity != null && el.opacity !== 100) props.push(`opacity: ${el.opacity}`);
      if (props.length > 0) lines.push(`  ${props.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function drawingToPlain(elements: DrawingElement[]): string {
  const texts: string[] = [];

  for (const el of elements) {
    if (el.isDeleted || el.type === "freedraw") continue;
    if (el.boundText) texts.push(el.boundText);
    if (el.type === "text" && el.text) texts.push(el.text);
  }

  return texts.join("\n");
}
