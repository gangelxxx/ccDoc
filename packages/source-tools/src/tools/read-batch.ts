import { resolve, relative } from 'path'
import type { Tool, ToolContext } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { readRangeContent } from './read-range.js'
import { countLines, assertWithinRoot } from '../utils/fs.js'
import { truncateOutput } from '../utils/format.js'

/** Maximum total lines across all fragments */
const TOTAL_LINE_BUDGET = 3000
/** Minimum lines per fragment after compression */
const MIN_LINES_PER_FRAGMENT = 10

interface RangeItem {
  path: string
  start_line?: number
  end_line?: number
  symbol?: string
  max_lines?: number
}

/**
 * Resolve a symbol to a line range using the SymbolParser.
 * Returns [startLine, endLine] or null if symbol not found.
 */
async function resolveSymbolRange(
  parser: SymbolParser,
  symbolName: string,
  absPath: string,
  projectRoot: string,
): Promise<[number, number] | null> {
  const symbolIndex = await parser.getSymbolIndex(projectRoot)
  const relPath = relative(projectRoot, absPath).replace(/\\/g, '/')

  // Try direct lookup by symbol name (index is keyed by symbol name)
  const candidates = symbolIndex.get(symbolName) ?? []
  for (const sym of candidates) {
    if (resolve(projectRoot, sym.filePath) === absPath || sym.filePath === relPath) {
      return [sym.startLine, sym.endLine]
    }
  }

  // Try dotted notation (ClassName.method)
  if (symbolName.includes('.')) {
    const dottedCandidates = symbolIndex.get(symbolName) ?? []
    for (const sym of dottedCandidates) {
      if (resolve(projectRoot, sym.filePath) === absPath || sym.filePath === relPath) {
        return [sym.startLine, sym.endLine]
      }
    }
  }

  return null
}

/**
 * Compute the effective line count for a range item.
 * Used to determine if total budget compression is needed.
 */
async function estimateLines(
  item: RangeItem,
  absPath: string,
  parser: SymbolParser | undefined,
  projectRoot: string,
): Promise<number> {
  const maxLines = item.max_lines ?? 80

  if (item.symbol && parser) {
    const range = await resolveSymbolRange(parser, item.symbol, absPath, projectRoot)
    if (range) {
      return Math.min(range[1] - range[0] + 1, maxLines)
    }
  }

  if (item.start_line != null || item.end_line != null) {
    const start = item.start_line ?? 1
    const end = item.end_line ?? start + maxLines
    return Math.min(end - start + 1, maxLines)
  }

  // Default: read from start with max_lines limit
  return maxLines
}

export function createReadBatchTool(parser?: SymbolParser): Tool {
  return {
    name: 'read_batch',
    description:
      'Read multiple file ranges or symbols in ONE call (max 15). ALWAYS use this instead of sequential read_range/read_symbol calls. Supports: {path, start_line, end_line}, {path, symbol}, or {path} for first 80 lines.',
    parameters: {
      type: 'object',
      properties: {
        ranges: {
          type: 'array',
          maxItems: 15,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              start_line: { type: 'number' },
              end_line: { type: 'number' },
              symbol: { type: 'string' },
              max_lines: { type: 'number', default: 80 },
            },
            required: ['path'],
          },
        },
      },
      required: ['ranges'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const ranges = params.ranges as RangeItem[]

        if (!Array.isArray(ranges) || ranges.length === 0) {
          return 'Error: ranges array is required and must not be empty'
        }

        if (ranges.length > 15) {
          return 'Error: maximum 15 ranges per request'
        }

        // Phase 1: Estimate total lines to determine if we need compression
        const absPaths = ranges.map((r) => resolve(ctx.projectRoot, r.path))
        for (const absPath of absPaths) {
          assertWithinRoot(absPath, ctx.projectRoot)
        }
        const estimates = await Promise.all(
          ranges.map((r, i) => estimateLines(r, absPaths[i], parser, ctx.projectRoot)),
        )

        const totalEstimated = estimates.reduce((sum, n) => sum + n, 0)

        // Phase 2: Compute effective max_lines per fragment (apply compression if needed)
        let effectiveMaxLines: number[]

        if (totalEstimated <= TOTAL_LINE_BUDGET) {
          effectiveMaxLines = ranges.map((r) => r.max_lines ?? 80)
        } else {
          const k = TOTAL_LINE_BUDGET / totalEstimated
          effectiveMaxLines = estimates.map((est) =>
            Math.max(MIN_LINES_PER_FRAGMENT, Math.floor(est * k)),
          )
        }

        // Phase 3: Read each fragment
        const blocks: string[] = []

        for (let i = 0; i < ranges.length; i++) {
          const item = ranges[i]
          const absPath = absPaths[i]
          const maxLines = effectiveMaxLines[i]

          let content: string
          let startLine: number
          let endLine: number

          // Determine what to read
          if (item.symbol && parser) {
            const range = await resolveSymbolRange(parser, item.symbol, absPath, ctx.projectRoot)
            if (range) {
              startLine = range[0]
              endLine = range[1]
            } else {
              blocks.push(`=== ${item.path} [symbol "${item.symbol}" not found] ===\nSymbol not found in this file.`)
              continue
            }
          } else if (item.start_line != null || item.end_line != null) {
            startLine = item.start_line ?? 1
            endLine = item.end_line ?? startLine + maxLines
          } else {
            startLine = 1
            // Try to get file length, but cap at maxLines
            try {
              const total = await countLines(absPath)
              endLine = Math.min(total, startLine + maxLines - 1)
            } catch {
              endLine = startLine + maxLines - 1
            }
          }

          try {
            content = await readRangeContent(absPath, startLine, endLine, maxLines)
          } catch (err) {
            content = `Error reading file: ${err instanceof Error ? err.message : String(err)}`
          }

          blocks.push(`=== ${item.path} [${startLine}-${endLine}] ===\n${content}`)
        }

        const output = blocks.join('\n\n')
        return truncateOutput(output, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
