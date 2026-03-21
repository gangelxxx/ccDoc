import React from 'react'
import type { DrawState, DrawElement } from './drawing-engine.js'
import { ShapeElement, LineElement, FreedrawElement, TextElement, ImageElement } from './svg/svg-elements.js'
import { SelectionOverlay } from './svg/SelectionOverlay.js'

// Re-export all sub-modules for consumers that imported from svg-renderer
export { resolveStrokeColor, wrapText, buildLinePath, buildFreedrawPath, diamondPoints, buildArrowheadPath, cubicBezierAt, cubicBezierTangent, FONT_FAMILIES, DARK_STROKE_COLORS, DASH_PATTERNS } from './svg/svg-helpers.js'
export { ShapeElement, LineElement, FreedrawElement, TextElement, ImageElement, TextLines } from './svg/svg-elements.js'
export { SelectionOverlay } from './svg/SelectionOverlay.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SvgSceneProps {
  state: DrawState
  width: number
  height: number
  selectedIds: Set<string>
  theme: 'light' | 'dark'
  editingBoundTextId?: string | null
  selectionRect?: { x1: number; y1: number; x2: number; y2: number } | null
  bindTarget?: DrawElement | null
  onPointerDown?: React.PointerEventHandler<SVGSVGElement>
  onPointerUp?: React.PointerEventHandler<SVGSVGElement>
  onDoubleClick?: React.MouseEventHandler<SVGSVGElement>
  onContextMenu?: React.MouseEventHandler<SVGSVGElement>
  onWheel?: React.WheelEventHandler<SVGSVGElement>
  cursor?: string
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SvgScene({
  state,
  width,
  height,
  selectedIds,
  theme,
  editingBoundTextId,
  selectionRect,
  bindTarget,
  onPointerDown,
  onPointerUp,
  onDoubleClick,
  onContextMenu,
  onWheel,
  cursor,
}: SvgSceneProps) {
  const { elements, appState } = state
  const { zoom, scrollX, scrollY, gridSize } = appState

  const bgColor = theme === 'dark' ? '#1e1e1e' : appState.viewBackgroundColor

  const visibleElements = elements.filter((el) => !el.isDeleted)
  const selectedElements = visibleElements.filter((el) => selectedIds.has(el.id))

  return (
    <svg
      width={width}
      height={height}
      style={{ width: '100%', height: '100%', cursor: cursor ?? 'default', display: 'block' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
    >
      {/* Defs: shadows, grid pattern */}
      <defs>
        <filter id="shadow-light" x="-20%" y="-20%" width="160%" height="160%">
          <feDropShadow dx={2} dy={4} stdDeviation={6} floodColor="rgba(0,0,0,0.15)" />
        </filter>
        <filter id="shadow-dark" x="-20%" y="-20%" width="160%" height="160%">
          <feDropShadow dx={1} dy={2} stdDeviation={5} floodColor="rgba(0,0,0,0.5)" />
        </filter>
        {gridSize && gridSize > 0 && (
          <pattern
            id="grid-pattern"
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            <line
              x1={0}
              y1={0}
              x2={gridSize}
              y2={0}
              stroke={theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
              strokeWidth={1}
            />
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={gridSize}
              stroke={theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
              strokeWidth={1}
            />
          </pattern>
        )}
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={width} height={height} fill={bgColor} />

      {/* Grid */}
      {gridSize && gridSize > 0 && (
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="url(#grid-pattern)"
          transform={`translate(${scrollX % gridSize}, ${scrollY % gridSize})`}
        />
      )}

      {/* Scene content — transformed by scroll & zoom */}
      <g transform={`translate(${scrollX}, ${scrollY}) scale(${zoom})`}>
        {visibleElements.map((el) => {
          switch (el.type) {
            case 'rectangle':
            case 'ellipse':
            case 'diamond':
              return <ShapeElement key={el.id} el={el} theme={theme} hideBoundText={editingBoundTextId === el.id} />
            case 'line':
            case 'arrow':
              return <LineElement key={el.id} el={el} theme={theme} hideBoundText={editingBoundTextId === el.id} />
            case 'freedraw':
              return <FreedrawElement key={el.id} el={el} theme={theme} />
            case 'text':
              if (editingBoundTextId === el.id) return null
              return <TextElement key={el.id} el={el} theme={theme} />
            case 'image':
              return <ImageElement key={el.id} el={el} theme={theme} />
            default:
              return null
          }
        })}

        {/* Selection overlays — pointer-events: none so clicks pass through to canvas */}
        <g pointerEvents="none">
        {selectedElements.map((el) => (
          <SelectionOverlay key={`sel-${el.id}`} el={el} />
        ))}
        </g>

        {/* Bind target highlight */}
        {bindTarget && !bindTarget.isDeleted && (
          <rect
            x={(bindTarget.width < 0 ? bindTarget.x + bindTarget.width : bindTarget.x) - 4}
            y={(bindTarget.height < 0 ? bindTarget.y + bindTarget.height : bindTarget.y) - 4}
            width={Math.abs(bindTarget.width) + 8}
            height={Math.abs(bindTarget.height) + 8}
            rx={6}
            ry={6}
            fill="none"
            stroke="#4a90d9"
            strokeWidth={2}
            opacity={0.6}
          />
        )}

        {/* Selection rectangle (rubber band) */}
        {selectionRect && (
          <rect
            x={Math.min(selectionRect.x1, selectionRect.x2)}
            y={Math.min(selectionRect.y1, selectionRect.y2)}
            width={Math.abs(selectionRect.x2 - selectionRect.x1)}
            height={Math.abs(selectionRect.y2 - selectionRect.y1)}
            fill="rgba(74, 144, 217, 0.1)"
            stroke="#4a90d9"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}
      </g>
    </svg>
  )
}
