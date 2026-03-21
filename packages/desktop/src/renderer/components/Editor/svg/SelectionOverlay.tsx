import React from 'react'
import type { DrawElement } from '../drawing-engine.js'
import { getSegmentMidpoint, initHandlesFromCatmullRom } from '../drawing-engine.js'

// ---------------------------------------------------------------------------
// SelectionOverlay
// ---------------------------------------------------------------------------

export function SelectionOverlay({
  el,
}: {
  el: DrawElement
}) {
  const pad = 4
  const isLineType = el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw'
  const pts = el.points

  if (isLineType && pts && pts.length >= 2) {
    // Bounding box of points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p[0] < minX) minX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] > maxY) maxY = p[1]
    }
    const bx = el.x + minX - pad
    const by = el.y + minY - pad
    const bw = maxX - minX + pad * 2
    const bh = maxY - minY + pad * 2

    // Freedraw: only show bounding box, no point handles
    if (el.type === 'freedraw') {
      return (
        <rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill="none"
          stroke="#4a90d9"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      )
    }

    // All control point handles (endpoints + intermediate)
    const handles = pts.map((p, i) => (
      <circle
        key={`ep-${i}`}
        cx={el.x + p[0]}
        cy={el.y + p[1]}
        r={5}
        fill={i === 0 || i === pts.length - 1 ? "white" : "#e0e8f0"}
        stroke="#4a90d9"
        strokeWidth={1.5}
      />
    ))

    // Midpoint handles
    const midHandles: React.ReactNode[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = getSegmentMidpoint(el, i)
      midHandles.push(
        <circle
          key={`mid-${i}`}
          cx={el.x + mid[0]}
          cy={el.y + mid[1]}
          r={4}
          fill="rgba(74, 144, 217, 0.4)"
          stroke="#4a90d9"
          strokeWidth={1}
        />,
      )
    }

    // Bezier handle lines and control points (only for round curves with >= 3 points)
    const bezierHandles: React.ReactNode[] = []
    const shouldShowBezier = el.arrowType === 'round' && pts.length >= 3
    if (shouldShowBezier) {
      // Ensure handles exist (compute from Catmull-Rom if missing)
      const h = el.handles ?? initHandlesFromCatmullRom(pts)
      for (let i = 0; i < pts.length - 1 && i < h.length; i++) {
        const p1 = pts[i]
        const p2 = pts[i + 1]
        const [cp1x, cp1y, cp2x, cp2y] = h[i]
        // Line from point to cp1
        bezierHandles.push(
          <line
            key={`hl1-${i}`}
            x1={el.x + p1[0]} y1={el.y + p1[1]}
            x2={el.x + cp1x} y2={el.y + cp1y}
            stroke="#e8a040" strokeWidth={1} opacity={0.6}
          />,
        )
        // Line from next point to cp2
        bezierHandles.push(
          <line
            key={`hl2-${i}`}
            x1={el.x + p2[0]} y1={el.y + p2[1]}
            x2={el.x + cp2x} y2={el.y + cp2y}
            stroke="#e8a040" strokeWidth={1} opacity={0.6}
          />,
        )
        // cp1 circle
        bezierHandles.push(
          <circle
            key={`hc1-${i}`}
            cx={el.x + cp1x} cy={el.y + cp1y}
            r={3.5}
            fill="#e8a040" stroke="#c07820" strokeWidth={1}
          />,
        )
        // cp2 circle
        bezierHandles.push(
          <circle
            key={`hc2-${i}`}
            cx={el.x + cp2x} cy={el.y + cp2y}
            r={3.5}
            fill="#e8a040" stroke="#c07820" strokeWidth={1}
          />,
        )
      }
    }

    return (
      <>
        <rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill="none"
          stroke="#4a90d9"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        {bezierHandles}
        {handles}
        {midHandles}
      </>
    )
  }

  // Shape / text selection
  const tx = el.width < 0 ? el.x + el.width : el.x
  const ty = el.height < 0 ? el.y + el.height : el.y
  const w = Math.abs(el.width)
  const h = Math.abs(el.height)

  const hSize = 8
  const half = hSize / 2
  const corners = [
    [tx - pad, ty - pad],
    [tx + w / 2, ty - pad],
    [tx + w + pad, ty - pad],
    [tx + w + pad, ty + h / 2],
    [tx + w + pad, ty + h + pad],
    [tx + w / 2, ty + h + pad],
    [tx - pad, ty + h + pad],
    [tx - pad, ty + h / 2],
  ]

  return (
    <>
      <rect
        x={tx - pad}
        y={ty - pad}
        width={w + pad * 2}
        height={h + pad * 2}
        fill="none"
        stroke="#4a90d9"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {corners.map(([cx, cy], i) => (
        <rect
          key={i}
          x={cx - half}
          y={cy - half}
          width={hSize}
          height={hSize}
          fill="white"
          stroke="#4a90d9"
          strokeWidth={1.5}
        />
      ))}
    </>
  )
}
