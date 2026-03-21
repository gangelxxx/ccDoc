import React from 'react'
import type { DrawElement } from '../drawing-engine.js'
import { getCurveControlPoints } from '../drawing-engine.js'
import type { ToolType } from './svg-helpers.js'
import {
  DASH_PATTERNS,
  resolveStrokeColor,
  getFontFamily,
  wrapText,
  buildLinePath,
  buildFreedrawPath,
  buildArrowheadPath,
  cubicBezierAt,
  diamondPoints,
} from './svg-helpers.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHAPE_TYPES: Set<ToolType> = new Set(['rectangle', 'ellipse', 'diamond'])

// ---------------------------------------------------------------------------
// TextLines
// ---------------------------------------------------------------------------

export function TextLines({
  text,
  fontSize,
  fontFamily,
  maxWidth,
  fill,
  textAnchor,
  x,
  startY,
}: {
  text: string
  fontSize: number
  fontFamily?: string
  maxWidth: number
  fill: string
  textAnchor: "start" | "middle" | "end" | "inherit"
  x: number
  startY: number
}) {
  const lines = wrapText(text, maxWidth, fontSize, fontFamily)
  const lineHeight = fontSize * 1.3
  const ff = getFontFamily(fontFamily)

  return (
    <text
      x={x}
      y={startY}
      fontSize={fontSize}
      fontFamily={ff}
      fill={fill}
      textAnchor={textAnchor}
      dominantBaseline="text-before-edge"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

// ---------------------------------------------------------------------------
// ShapeElement
// ---------------------------------------------------------------------------

export function ShapeElement({
  el,
  theme,
  hideBoundText,
}: {
  el: DrawElement
  theme: 'light' | 'dark'
  hideBoundText?: boolean
}) {
  const stroke = resolveStrokeColor(el.strokeColor, theme)
  const dash = DASH_PATTERNS[el.strokeStyle] || ''
  const filter = SHAPE_TYPES.has(el.type) ? `url(#shadow-${theme})` : undefined
  const w = Math.abs(el.width)
  const h = Math.abs(el.height)

  let shape: React.ReactNode
  switch (el.type) {
    case 'rectangle': {
      const r = el.roundness === 'round' ? Math.min(w, h) * 0.1 : 0
      shape = (
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          rx={r}
          ry={r}
          fill={el.backgroundColor}
          stroke={stroke}
          strokeWidth={el.strokeWidth}
          strokeDasharray={dash || undefined}
          filter={filter}
        />
      )
      break
    }
    case 'ellipse':
      shape = (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={el.backgroundColor}
          stroke={stroke}
          strokeWidth={el.strokeWidth}
          strokeDasharray={dash || undefined}
          filter={filter}
        />
      )
      break
    case 'diamond':
      shape = (
        <polygon
          points={diamondPoints(w, h)}
          fill={el.backgroundColor}
          stroke={stroke}
          strokeWidth={el.strokeWidth}
          strokeDasharray={dash || undefined}
          filter={filter}
        />
      )
      break
    default:
      return null
  }

  // Bound text — auto-shrink font to fit inside shape
  let boundTextNode: React.ReactNode = null
  if (el.boundText && !hideBoundText) {
    const baseFontSize = el.boundTextFontSize ?? 16
    const isEllipse = el.type === 'ellipse'
    const isDiamond = el.type === 'diamond'
    // Ellipse/diamond have less usable space than rectangles
    const maxW = (isEllipse || isDiamond) ? w * 0.65 : w * 0.85
    const maxH = (isEllipse || isDiamond) ? h * 0.65 : h * 0.85
    let bfs = baseFontSize
    let lines = wrapText(el.boundText, maxW, bfs, el.fontFamily)
    let lineH = bfs * 1.3
    let totalH = lines.length * lineH
    // Shrink font until text fits vertically (min 6px)
    while (totalH > maxH && bfs > 6) {
      bfs -= 1
      lines = wrapText(el.boundText, maxW, bfs, el.fontFamily)
      lineH = bfs * 1.3
      totalH = lines.length * lineH
    }
    // Hide text if it still doesn't fit at minimum font size
    if (totalH > maxH) {
      // text won't fit even at min size — hide it
    } else {
    const startY = (h - totalH) / 2

    boundTextNode = (
      <TextLines
        text={el.boundText}
        fontSize={bfs}
        fontFamily={el.fontFamily}
        maxWidth={maxW}
        fill={stroke}
        textAnchor="middle"
        x={w / 2}
        startY={startY}
      />
    )
    } // else (text fits)
  }

  const tx = el.width < 0 ? el.x + el.width : el.x
  const ty = el.height < 0 ? el.y + el.height : el.y

  return (
    <g
      transform={`translate(${tx}, ${ty})${el.angle ? ` rotate(${(el.angle * 180) / Math.PI}, ${w / 2}, ${h / 2})` : ''}`}
      opacity={el.opacity / 100}
    >
      {shape}
      {boundTextNode}
    </g>
  )
}

// ---------------------------------------------------------------------------
// LineElement
// ---------------------------------------------------------------------------

export function LineElement({
  el,
  theme,
  hideBoundText,
}: {
  el: DrawElement
  theme: 'light' | 'dark'
  hideBoundText?: boolean
}) {
  const stroke = resolveStrokeColor(el.strokeColor, theme)
  const dash = DASH_PATTERNS[el.strokeStyle] || ''
  const pts = el.points
  if (!pts || pts.length < 2) return null

  const d = buildLinePath(el)

  // Arrowheads
  const arrowheads: React.ReactNode[] = []

  const hasEnd = el.type === 'arrow' && el.arrowhead === 'arrow'
  const hasStart = el.startArrowhead === 'arrow'

  if (hasEnd && pts.length >= 2) {
    const tip = pts[pts.length - 1]
    let from: [number, number] = pts[pts.length - 2]
    const hasCurveHandles = el.handles && el.handles.length > 0
    if ((el.arrowType === 'round' && pts.length >= 3) || hasCurveHandles) {
      const segIdx = pts.length - 2
      const { cp1, cp2 } = getCurveControlPoints(pts, segIdx, el.handles)
      // Sample at t=0.5 of last segment for visually accurate arrowhead direction
      from = cubicBezierAt(pts[segIdx], cp1, cp2, tip, 0.5)
    }
    arrowheads.push(
      <path
        key="end-arrow"
        d={buildArrowheadPath(tip[0], tip[1], from[0], from[1], el.strokeWidth)}
        stroke={stroke}
        strokeWidth={el.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />,
    )
  }

  if (hasStart && pts.length >= 2) {
    const tip = pts[0]
    let from: [number, number] = pts[1]
    const hasCurveHandles = el.handles && el.handles.length > 0
    if ((el.arrowType === 'round' && pts.length >= 3) || hasCurveHandles) {
      const { cp1, cp2 } = getCurveControlPoints(pts, 0, el.handles)
      // Sample at t=0.5 of first segment for visually accurate arrowhead direction
      from = cubicBezierAt(tip, cp1, cp2, pts[1], 0.5)
    }
    arrowheads.push(
      <path
        key="start-arrow"
        d={buildArrowheadPath(tip[0], tip[1], from[0], from[1], el.strokeWidth)}
        stroke={stroke}
        strokeWidth={el.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />,
    )
  }

  // Compute label box for bound text
  let labelBox: { cx: number; cy: number; w: number; h: number; fontSize: number; lines: string[] } | null = null
  if (el.boundText && !hideBoundText) {
    const midPt: [number, number] = (() => {
      if (pts.length < 2) return [0, 0] as [number, number]
      // Compute total length of polyline
      const segLens: number[] = []
      let totalLen = 0
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0]
        const dy = pts[i + 1][1] - pts[i][1]
        const len = Math.sqrt(dx * dx + dy * dy)
        segLens.push(len)
        totalLen += len
      }
      // Walk to half-length
      let remaining = totalLen / 2
      for (let i = 0; i < segLens.length; i++) {
        if (remaining <= segLens[i] || i === segLens.length - 1) {
          const t = segLens[i] > 0 ? remaining / segLens[i] : 0
          return [
            pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
            pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
          ] as [number, number]
        }
        remaining -= segLens[i]
      }
      return [pts[0][0], pts[0][1]] as [number, number]
    })()
    const fontSize = el.boundTextFontSize ?? 14
    const padX = 8
    const padY = 4
    const charW = fontSize * 0.6
    const textLines = el.boundText.split('\n')
    const maxLineW = Math.max(...textLines.map(l => l.length * charW), 20)
    const boxW = maxLineW + padX * 2
    const boxH = textLines.length * fontSize * 1.3 + padY * 2
    labelBox = { cx: midPt[0], cy: midPt[1], w: boxW, h: boxH, fontSize, lines: textLines }
  }

  const clipId = labelBox ? `line-label-clip-${el.id}` : undefined

  return (
    <g transform={`translate(${el.x}, ${el.y})`} opacity={el.opacity / 100}>
      {clipId && labelBox && (
        <defs>
          <clipPath id={clipId}>
            {/* Full area minus the label box */}
            <path d={`M -99999 -99999 H 99999 V 99999 H -99999 Z M ${labelBox.cx - labelBox.w / 2} ${labelBox.cy - labelBox.h / 2} v ${labelBox.h} h ${labelBox.w} v ${-labelBox.h} Z`} clipRule="evenodd" />
          </clipPath>
        </defs>
      )}
      <path
        d={d}
        stroke={stroke}
        strokeWidth={el.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash || undefined}
        clipPath={clipId ? `url(#${clipId})` : undefined}
      />
      {arrowheads}
      {labelBox && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={labelBox.cx - labelBox.w / 2}
            y={labelBox.cy - labelBox.h / 2}
            width={labelBox.w}
            height={labelBox.h}
            rx={4}
            ry={4}
            fill={theme === 'dark' ? '#1e1e1e' : '#ffffff'}
            stroke={stroke}
            strokeWidth={1}
          />
          {labelBox.lines.map((line, i) => (
            <text
              key={i}
              x={labelBox!.cx}
              y={labelBox!.cy - (labelBox!.lines.length - 1) * labelBox!.fontSize * 1.3 / 2 + i * labelBox!.fontSize * 1.3 + labelBox!.fontSize * 0.35}
              textAnchor="middle"
              fill={stroke}
              fontSize={labelBox!.fontSize}
              fontFamily={el.fontFamily || 'Segoe UI, sans-serif'}
            >
              {line}
            </text>
          ))}
        </g>
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// FreedrawElement
// ---------------------------------------------------------------------------

export function FreedrawElement({
  el,
  theme,
}: {
  el: DrawElement
  theme: 'light' | 'dark'
}) {
  const pts = el.points
  if (!pts || pts.length === 0) return null

  const stroke = resolveStrokeColor(el.strokeColor, theme)
  const d = buildFreedrawPath(pts)

  return (
    <path
      transform={`translate(${el.x}, ${el.y})`}
      d={d}
      stroke={stroke}
      strokeWidth={el.strokeWidth}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={el.opacity / 100}
    />
  )
}

// ---------------------------------------------------------------------------
// TextElement
// ---------------------------------------------------------------------------

export function TextElement({
  el,
  theme,
}: {
  el: DrawElement
  theme: 'light' | 'dark'
}) {
  const fill = resolveStrokeColor(el.strokeColor, theme)
  const fs = el.fontSize ?? 16
  const maxW = Math.abs(el.width) || 9999
  const anchor =
    el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start'
  const tx =
    el.textAlign === 'center'
      ? el.x + maxW / 2
      : el.textAlign === 'right'
        ? el.x + maxW
        : el.x

  return (
    <g opacity={el.opacity / 100}>
      <TextLines
        text={el.text ?? ''}
        fontSize={fs}
        fontFamily={el.fontFamily}
        maxWidth={maxW}
        fill={fill}
        textAnchor={anchor}
        x={tx}
        startY={el.y}
      />
    </g>
  )
}

// ---------------------------------------------------------------------------
// ImageElement
// ---------------------------------------------------------------------------

export function ImageElement({
  el,
  theme,
}: {
  el: DrawElement
  theme: 'light' | 'dark'
}) {
  if (!el.imageData) return null
  const stroke = resolveStrokeColor(el.strokeColor, theme)
  const dash = DASH_PATTERNS[el.strokeStyle] || ''
  const w = Math.abs(el.width)
  const h = Math.abs(el.height)
  const tx = el.width < 0 ? el.x + el.width : el.x
  const ty = el.height < 0 ? el.y + el.height : el.y

  return (
    <g
      transform={`translate(${tx}, ${ty})`}
      opacity={el.opacity / 100}
    >
      <image
        href={el.imageData}
        x={0}
        y={0}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid meet"
      />
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill="none"
        stroke={stroke}
        strokeWidth={el.strokeWidth}
        strokeDasharray={dash || undefined}
      />
    </g>
  )
}
