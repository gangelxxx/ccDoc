import type { DrawElement } from '../drawing-engine.js'
import { getCurveControlPoints } from '../drawing-engine.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FONT_FAMILIES: Record<string, string> = {
  hand: "'Segoe UI', sans-serif",
  normal: "Arial, Helvetica, sans-serif",
  code: "'Cascadia Code', 'Fira Code', monospace",
  headline: "Georgia, 'Times New Roman', serif",
}

const CHAR_WIDTH_FACTOR: Record<string, number> = {
  hand: 0.65,
  normal: 0.6,
  code: 0.55,
  headline: 0.6,
}

export const DARK_STROKE_COLORS = new Set([
  '#1a1a1a', '#000000', '#1e1e1e', '#111111', '#0d0d0d', '#222222',
])

export const DASH_PATTERNS: Record<string, string> = {
  solid: '',
  dashed: '8 8',
  dotted: '2 4',
}

export type { ToolType } from '../drawing-engine.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveStrokeColor(color: string, theme: 'light' | 'dark'): string {
  if (theme === 'dark' && DARK_STROKE_COLORS.has(color.toLowerCase())) {
    return '#e0e0e0'
  }
  return color
}

export function getFontFamily(family?: string): string {
  return FONT_FAMILIES[family ?? 'normal'] ?? FONT_FAMILIES.normal
}

export function getCharWidth(fontSize: number, family?: string): number {
  const factor = CHAR_WIDTH_FACTOR[family ?? 'normal'] ?? 0.6
  return fontSize * factor
}

/** Simple word-wrap returning lines of text. */
export function wrapText(text: string, maxWidth: number, fontSize: number, family?: string): string[] {
  if (!text) return []
  const charW = getCharWidth(fontSize, family)
  const maxChars = Math.max(1, Math.floor(maxWidth / charW))
  const result: string[] = []

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      result.push('')
      continue
    }
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      // Break long words that exceed maxChars
      let remaining = word
      while (remaining.length > maxChars) {
        const chunk = remaining.slice(0, maxChars - (line ? line.length + 1 : 0) || maxChars)
        if (line) {
          result.push(line)
          line = ''
        }
        if (chunk.length === 0) break
        result.push(chunk)
        remaining = remaining.slice(chunk.length)
      }
      const test = line ? `${line} ${remaining}` : remaining
      if (test.length > maxChars && line) {
        result.push(line)
        line = remaining
      } else {
        line = test
      }
    }
    if (line) result.push(line)
  }
  return result
}

/** Build SVG path `d` for a line/arrow element using its points array. */
export function buildLinePath(el: DrawElement): string {
  const pts = el.points
  if (!pts || pts.length < 2) return ''

  const hasCurveHandles = el.handles && el.handles.length > 0
  const isRound = (el.arrowType === 'round' && pts.length >= 3) || hasCurveHandles

  if (isRound) {
    let d = `M ${pts[0][0]} ${pts[0][1]}`
    for (let i = 0; i < pts.length - 1; i++) {
      const { cp1, cp2 } = getCurveControlPoints(pts, i, el.handles)
      const next = pts[i + 1]
      d += ` C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${next[0]} ${next[1]}`
    }
    return d
  }

  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
}

/** Evaluate cubic bezier at parameter t */
export function cubicBezierAt(
  p0: [number, number], cp1: [number, number], cp2: [number, number], p3: [number, number], t: number,
): [number, number] {
  const u = 1 - t
  return [
    u * u * u * p0[0] + 3 * u * u * t * cp1[0] + 3 * u * t * t * cp2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * cp1[1] + 3 * u * t * t * cp2[1] + t * t * t * p3[1],
  ]
}

/** Derivative of cubic bezier at parameter t — returns tangent vector */
export function cubicBezierTangent(
  p0: [number, number], cp1: [number, number], cp2: [number, number], p3: [number, number], t: number,
): [number, number] {
  const u = 1 - t
  return [
    3 * u * u * (cp1[0] - p0[0]) + 6 * u * t * (cp2[0] - cp1[0]) + 3 * t * t * (p3[0] - cp2[0]),
    3 * u * u * (cp1[1] - p0[1]) + 6 * u * t * (cp2[1] - cp1[1]) + 3 * t * t * (p3[1] - cp2[1]),
  ]
}

/** Build the arrowhead path (V-shape) at the tip of a line. */
export function buildArrowheadPath(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  strokeWidth: number,
): string {
  const headLen = 10 + strokeWidth * 2
  const angle = Math.atan2(tipY - fromY, tipX - fromX)
  const a = Math.PI / 6
  const x1 = tipX - headLen * Math.cos(angle - a)
  const y1 = tipY - headLen * Math.sin(angle - a)
  const x2 = tipX - headLen * Math.cos(angle + a)
  const y2 = tipY - headLen * Math.sin(angle + a)
  return `M ${x1} ${y1} L ${tipX} ${tipY} L ${x2} ${y2}`
}

/** Freedraw path using quadratic bezier smoothing with midpoints. */
export function buildFreedrawPath(pts: [number, number][]): string {
  if (!pts || pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0]} ${pts[0][1]}`
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`

  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const curr = pts[i]
    const next = pts[i + 1]
    const mx = (curr[0] + next[0]) / 2
    const my = (curr[1] + next[1]) / 2
    d += ` Q ${curr[0]} ${curr[1]}, ${mx} ${my}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last[0]} ${last[1]}`
  return d
}

/** Diamond polygon points string (centered at 0,0). */
export function diamondPoints(w: number, h: number): string {
  const hw = w / 2
  const hh = h / 2
  return `${hw},0 ${w},${hh} ${hw},${h} 0,${hh}`
}
