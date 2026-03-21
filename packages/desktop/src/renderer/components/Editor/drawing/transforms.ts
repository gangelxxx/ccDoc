// Coordinate transforms and grid snapping

export function viewportToScene(
  vx: number,
  vy: number,
  scrollX: number,
  scrollY: number,
  zoom: number,
): [number, number] {
  return [(vx - scrollX) / zoom, (vy - scrollY) / zoom];
}

export function sceneToViewport(
  sx: number,
  sy: number,
  scrollX: number,
  scrollY: number,
  zoom: number,
): [number, number] {
  return [sx * zoom + scrollX, sy * zoom + scrollY];
}

export function snapToGrid(value: number, gridSize: number | null): number {
  if (!gridSize) return value;
  return Math.round(value / gridSize) * gridSize;
}
