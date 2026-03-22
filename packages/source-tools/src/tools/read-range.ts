import { resolve } from 'path'
import type { Tool, ToolContext } from './types.js'
import { readLines, countLines, assertWithinRoot } from '../utils/fs.js'
import { truncateOutput } from '../utils/format.js'

/**
 * Format a range of lines with right-aligned line numbers.
 *
 * @param lines     - Array of line contents
 * @param startLine - 1-based line number of the first element in `lines`
 * @param maxWidth  - Width for the line number column
 * @returns Formatted string with numbered lines
 */
function formatNumberedLines(
  lines: string[],
  startLine: number,
  maxWidth: number,
): string {
  return lines
    .map((line, i) => {
      const num = String(startLine + i).padStart(maxWidth, ' ')
      return `${num}| ${line}`
    })
    .join('\n')
}

/**
 * Core helper that reads a file range and returns formatted numbered output.
 * Exported so read_batch can reuse this logic without going through the Tool interface.
 *
 * @param absPath   - Absolute path to the file
 * @param startLine - 1-based start line (defaults to 1)
 * @param endLine   - 1-based end line (if undefined, startLine + 100)
 * @param maxLines  - Maximum lines to return before applying skip compression (default 200)
 * @returns Formatted string with numbered lines and optional skip marker
 */
export async function readRangeContent(
  absPath: string,
  startLine: number = 1,
  endLine?: number,
  maxLines: number = 200,
): Promise<string> {
  const totalLines = await countLines(absPath)

  // Clamp start
  const start = Math.max(1, startLine)
  // Default end: start + 100, clamped to file length
  const end = Math.min(endLine ?? start + 100, totalLines)

  if (start > totalLines) {
    return `File has ${totalLines} lines, requested start ${start} is beyond end of file.`
  }

  if (end < start) {
    return `Invalid range: end line ${end} is before start line ${start}.`
  }

  const rangeSize = end - start + 1
  const numWidth = String(end).length

  // Small enough range — return it all
  if (rangeSize <= maxLines) {
    const lines = await readLines(absPath, start, end)
    return formatNumberedLines(lines, start, numWidth)
  }

  // Range exceeds maxLines — show first half + skip marker + last half
  const halfLines = Math.floor(maxLines / 2)
  const firstEnd = start + halfLines - 1
  const lastStart = end - halfLines + 1
  const skipped = lastStart - firstEnd - 1

  const [firstPart, lastPart] = await Promise.all([
    readLines(absPath, start, firstEnd),
    readLines(absPath, lastStart, end),
  ])

  const firstFormatted = formatNumberedLines(firstPart, start, numWidth)
  const skipMarker = `${''.padStart(numWidth, '.')}| ... [skipped ${skipped} lines] ...`
  const lastFormatted = formatNumberedLines(lastPart, lastStart, numWidth)

  return `${firstFormatted}\n${skipMarker}\n${lastFormatted}`
}

export function createReadRangeTool(): Tool {
  return {
    name: 'read_range',
    description:
      'Read file lines with numbers. Prefer read_batch for multiple ranges. Large ranges auto-compressed with skip marker.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'number', default: 1 },
        end_line: { type: 'number' },
        max_lines: { type: 'number', default: 200 },
      },
      required: ['path'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const filePath = params.path as string
        const absPath = resolve(ctx.projectRoot, filePath)
        assertWithinRoot(absPath, ctx.projectRoot)
        const startLine = typeof params.start_line === 'number' ? params.start_line : 1
        const endLine = typeof params.end_line === 'number' ? params.end_line : undefined
        const maxLines = typeof params.max_lines === 'number' ? params.max_lines : 200

        const result = await readRangeContent(absPath, startLine, endLine, maxLines)
        return truncateOutput(result, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
