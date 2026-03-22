import { readFile } from 'fs/promises'
import { resolve, relative } from 'path'
import type { Tool, ToolContext, Symbol } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { countLines, assertWithinRoot } from '../utils/fs.js'
import { truncateOutput } from '../utils/format.js'

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * Format an import into a compact, readable string.
 *
 * Named:   `{ A, B } from './path'`
 * Default: `DefaultName from './path'`
 * Namespace: `* as Name from './path'`
 */
function formatImportLine(names: string[], source: string): string {
  if (names.length === 0) return `'${source}'`

  // Namespace import — already has `* as X` in the name
  if (names.length === 1 && names[0].startsWith('* as ')) {
    return `${names[0]} from '${source}'`
  }

  // Single default (no braces) vs named imports
  if (names.length === 1 && !names[0].includes(',')) {
    // Heuristic: if name looks like a normal identifier it's a default import
    // This is imperfect but aligns with our extractor output
    return `${names[0]} from '${source}'`
  }

  return `{ ${names.join(', ')} } from '${source}'`
}

/**
 * Build the line-range annotation for a symbol.
 * Single-line  → `[N]`
 * Multi-line   → `[N-M]`
 */
function lineRange(sym: Symbol): string {
  if (sym.startLine === sym.endLine) return `[${sym.startLine}]`
  return `[${sym.startLine}-${sym.endLine}]`
}

/** Pad range annotation to align nicely (right-side, within column budget) */
function padRange(range: string, lineWidth: number): string {
  const padding = Math.max(1, lineWidth - range.length)
  return ' '.repeat(padding) + range
}

/**
 * Render a single symbol line. Example:
 * `  15: interface EngineConfig { ... }              [15-28]`
 */
function renderSymbolLine(
  sym: Symbol,
  rangeColumnWidth: number,
  includeJsdoc: boolean,
): string[] {
  const lines: string[] = []
  const lineNo = String(sym.startLine)
  const range = lineRange(sym)
  const paddedRange = padRange(range, rangeColumnWidth)

  // JSDoc line if requested
  if (includeJsdoc && sym.jsdoc) {
    lines.push(`  ${lineNo}: /** ${sym.jsdoc} */`)
    lines.push(`      ${sym.signature}${paddedRange}`)
  } else {
    lines.push(`  ${lineNo}: ${sym.signature}${paddedRange}`)
  }

  // Class/interface children — methods and properties
  if (sym.children && sym.children.length > 0) {
    for (const child of sym.children) {
      const childRange = `[${child.startLine}${child.startLine !== child.endLine ? '-' + child.endLine : ''}]`
      const childPadded = padRange(childRange, rangeColumnWidth)
      if (includeJsdoc && child.jsdoc) {
        lines.push(`        /** ${child.jsdoc} */`)
        lines.push(`        ${child.signature}${childPadded}`)
      } else {
        lines.push(`        ${child.signature}${childPadded}`)
      }
    }
  }

  return lines
}

/**
 * Compute the width budget for range annotations so they align across symbols.
 */
function computeRangeColumnWidth(symbols: Symbol[]): number {
  let maxLen = 0
  for (const sym of symbols) {
    const range = lineRange(sym)
    if (range.length > maxLen) maxLen = range.length
    if (sym.children) {
      for (const child of sym.children) {
        const childRange = `[${child.startLine}${child.startLine !== child.endLine ? '-' + child.endLine : ''}]`
        if (childRange.length > maxLen) maxLen = childRange.length
      }
    }
  }
  // Add some padding (at least 2 spaces before the range)
  return maxLen + 2
}

/**
 * Render the full outline for a single file.
 */
function renderFileOutline(
  relPath: string,
  totalLines: number,
  imports: Array<{ names: string[]; source: string }>,
  exported: Symbol[],
  internal: Symbol[],
  includePrivate: boolean,
  includeJsdoc: boolean,
  parseFailed: boolean,
): string {
  const lines: string[] = []

  lines.push(`=== ${relPath} (${totalLines} lines) ===`)
  lines.push('')

  // IMPORTS section
  if (imports.length > 0) {
    lines.push('IMPORTS:')
    for (const imp of imports) {
      lines.push(`  ${formatImportLine(imp.names, imp.source)}`)
    }
    lines.push('')
  }

  // If parse failed (unsupported language), show only line count info
  if (parseFailed) {
    return lines.join('\n')
  }

  // EXPORTS section
  if (exported.length > 0) {
    const rangeWidth = computeRangeColumnWidth(exported)
    lines.push('EXPORTS:')
    for (const sym of exported) {
      lines.push(...renderSymbolLine(sym, rangeWidth, includeJsdoc))
    }
  }

  // INTERNAL section (only when include_private is true)
  if (includePrivate && internal.length > 0) {
    if (exported.length > 0) lines.push('')
    const rangeWidth = computeRangeColumnWidth(internal)
    lines.push('INTERNAL:')
    for (const sym of internal) {
      lines.push(...renderSymbolLine(sym, rangeWidth, includeJsdoc))
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createFileOutlineTool(parser: SymbolParser): Tool {
  return {
    name: 'file_outline',
    description:
      'Show imports + exported symbol signatures with line numbers for up to 20 files at once. Use BEFORE reading file contents — gives 80% understanding at 10% token cost. Always batch multiple files in one call.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'File paths relative to project root',
        },
        include_private: {
          type: 'boolean',
          default: false,
          description: 'Include non-exported (internal) symbols in a separate section',
        },
        include_jsdoc: {
          type: 'boolean',
          default: false,
          description: 'Show JSDoc comments above symbols',
        },
      },
      required: ['paths'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const paths = params.paths as string[]
        const includePrivate = params.include_private === true
        const includeJsdoc = params.include_jsdoc === true

        if (!paths || paths.length === 0) {
          return 'Error: paths array is required and must not be empty'
        }

        const blocks: string[] = []

        for (const filePath of paths) {
          const absPath = resolve(ctx.projectRoot, filePath)
          assertWithinRoot(absPath, ctx.projectRoot)
          const relPath = relative(ctx.projectRoot, absPath).replace(/\\/g, '/')

          // Read file content
          let content: string
          try {
            content = await readFile(absPath, 'utf-8')
          } catch (err) {
            blocks.push(`=== ${relPath} ===\nError: ${(err as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : (err as Error).message}`)
            continue
          }

          // Count total lines
          const totalLines = await countLines(absPath)

          // Parse file
          let symbols: Symbol[]
          let imports: Array<{ names: string[]; source: string }>
          let parseFailed = false

          try {
            const parsed = parser.parseFile(filePath, content)
            symbols = parsed.symbols
            imports = parsed.imports.map((imp) => ({
              names: imp.names,
              source: imp.source,
            }))
          } catch {
            // Unsupported language or parse error
            symbols = []
            imports = []
            parseFailed = true
          }

          // Separate exported vs internal
          const exported = symbols.filter((s) => s.exported)
          const internal = symbols.filter((s) => !s.exported)

          // Sort by line number
          exported.sort((a, b) => a.startLine - b.startLine)
          internal.sort((a, b) => a.startLine - b.startLine)

          blocks.push(
            renderFileOutline(
              relPath,
              totalLines,
              imports,
              exported,
              internal,
              includePrivate,
              includeJsdoc,
              parseFailed,
            ),
          )
        }

        const output = blocks.join('\n\n')
        return truncateOutput(output, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
