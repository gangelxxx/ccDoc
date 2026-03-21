// Re-export everything from drawing engine modules

// Types
export type { ToolType, DrawElement, DrawState, ResizeHandle } from "./types.js";

// State management
export { generateId, createDefaultState, parseDrawState, serializeDrawState, createElement } from "./state.js";

// Coordinate transforms
export { viewportToScene, sceneToViewport, snapToGrid } from "./transforms.js";

// Curves
export { catmullRomToBezier, shouldUseCurves, getCurveControlPoints, initHandlesFromCatmullRom, getSegmentMidpoint } from "./curves.js";

// Hit testing
export {
  hitTest, distToSegment,
  getEndpointAtPoint, getResizeHandleAtPoint, getHandleAtPoint, getMidpointAtPoint,
  getElementsInSelectionBox, getElementBounds, getElementCenter, getResizeHandleCursor,
} from "./hit-testing.js";

// Bindings
export {
  isBindableElement, findBindTarget, getBindingPoint,
  computeAnchor, anchorToPoint, updateBindings,
} from "./bindings.js";

// Rendering
export {
  FONT_FAMILIES, DARK_STROKE_SET,
  applyStrokeStyle, applyShadow, clearShadow,
  wrapText, roundedRectPath, drawArrowhead, getArrowAngle,
  renderScene, renderSelectionRect, renderBindHighlight,
} from "./render.js";

// Operations
export { duplicateElements, moveElementsToFront, moveElementsToBack } from "./operations.js";

// History
export { HistoryStack } from "./history.js";
