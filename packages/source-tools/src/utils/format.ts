/**
 * Truncate output to fit within character budget.
 * If truncated, appends a marker showing how many chars were omitted.
 */
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const overflow = text.length - maxChars
  const marker = `\n[truncated, +${overflow} chars]`

  // Cut at maxChars minus marker length so the total fits
  const cutAt = Math.max(0, maxChars - marker.length)
  return text.slice(0, cutAt) + marker
}
