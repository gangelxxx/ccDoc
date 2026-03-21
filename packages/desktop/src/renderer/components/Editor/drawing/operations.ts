// Element operations: duplicate, z-order

import type { DrawElement } from "./types.js";
import { generateId } from "./state.js";

export function duplicateElements(elements: DrawElement[], ids: Set<string>): DrawElement[] {
  const offset = 20;
  return elements
    .filter((el) => ids.has(el.id) && !el.isDeleted)
    .map((el) => ({
      ...structuredClone(el),
      id: generateId(),
      x: el.x + offset,
      y: el.y + offset,
    }));
}

export function moveElementsToFront(elements: DrawElement[], ids: Set<string>): DrawElement[] {
  const selected: DrawElement[] = [];
  const rest: DrawElement[] = [];
  for (const el of elements) {
    if (ids.has(el.id)) selected.push(el);
    else rest.push(el);
  }
  return [...rest, ...selected];
}

export function moveElementsToBack(elements: DrawElement[], ids: Set<string>): DrawElement[] {
  const selected: DrawElement[] = [];
  const rest: DrawElement[] = [];
  for (const el of elements) {
    if (ids.has(el.id)) selected.push(el);
    else rest.push(el);
  }
  return [...selected, ...rest];
}
