import { readFile } from 'fs/promises'
import { resolve, relative } from 'path'
import type { Tool, ToolContext, Symbol } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { readLines, assertWithinRoot } from '../utils/fs.js'
import { truncateOutput } from '../utils/format.js'

// ---------------------------------------------------------------------------
// Helper — exported for use by other tools
// ---------------------------------------------------------------------------

/**
 * Read the source code of a symbol by name.
 *
 * Handles `ClassName.methodName` dotted notation for class members.
 * Returns formatted source with a path comment header.
 */
export async function readSymbolContent(
  parser: SymbolParser,
  symbolName: string,
  absPath: string | undefined,
  maxLines: number,
  projectRoot: string,
): Promise<string> {
  const isDotted = symbolName.includes('.')
  const [parentName, memberName] = isDotted
    ? symbolName.split('.', 2)
    : [undefined, symbolName]

  // Find the symbol
  let matchedSymbol: Symbol | undefined
  let matchedFile: string | undefined

  if (absPath) {
    // Search in a specific file
    let content: string
    try {
      content = await readFile(absPath, 'utf-8')
    } catch {
      return `Error: could not read file ${absPath}`
    }

    const relPath = relative(projectRoot, absPath).replace(/\\/g, '/')
    const { symbols } = parser.parseFile(relPath, content)
    matchedSymbol = findSymbolInList(symbols, parentName, memberName)
    matchedFile = absPath
  } else {
    // Search the entire project symbol index (keyed by symbol name)
    const symbolIndex = await parser.getSymbolIndex(projectRoot)

    if (isDotted) {
      // Dotted notation: look up "ClassName.methodName" directly
      const candidates = symbolIndex.get(symbolName) ?? []
      if (candidates.length > 0) {
        matchedSymbol = candidates[0]
        matchedFile = resolve(projectRoot, matchedSymbol.filePath)
      }
    } else {
      // Direct symbol name lookup
      const candidates = symbolIndex.get(memberName) ?? []
      if (candidates.length > 0) {
        matchedSymbol = candidates[0]
        matchedFile = resolve(projectRoot, matchedSymbol.filePath)
      }
    }
  }

  if (!matchedSymbol || !matchedFile) {
    return `Error: symbol "${symbolName}" not found${absPath ? ` in ${relative(projectRoot, absPath).replace(/\\/g, '/')}` : ''}`
  }

  const relPath = relative(projectRoot, matchedFile).replace(/\\/g, '/')
  const { startLine, endLine } = matchedSymbol
  const lineCount = endLine - startLine + 1

  // For classes that exceed maxLines, show outline instead of full body
  if (lineCount > maxLines && matchedSymbol.kind === 'class') {
    return renderClassOutline(matchedSymbol, relPath)
  }

  // Read the actual source lines
  const lines = await readLines(matchedFile, startLine, endLine)

  // Truncate if needed
  if (lineCount > maxLines) {
    const keepLines = maxLines - 5
    const truncatedLines = lines.slice(0, keepLines)
    const remaining = lineCount - keepLines
    return formatSourceBlock(relPath, startLine, startLine + keepLines - 1, truncatedLines, remaining)
  }

  return formatSourceBlock(relPath, startLine, endLine, lines)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Locate a symbol in a flat list, handling parent.member dotted names.
 */
function findSymbolInList(
  symbols: Symbol[],
  parentName: string | undefined,
  memberName: string,
): Symbol | undefined {
  if (parentName) {
    // Find parent (class/interface), then locate child member
    const parent = symbols.find(
      (s) => s.name === parentName && (s.kind === 'class' || s.kind === 'interface'),
    )
    if (!parent?.children) return undefined
    return parent.children.find((c) => c.name === memberName)
  }

  // Direct top-level match
  return symbols.find((s) => s.name === memberName)
}

/**
 * Format source lines with a path header and line numbers.
 */
function formatSourceBlock(
  relPath: string,
  startLine: number,
  endLine: number,
  lines: string[],
  remainingLines?: number,
): string {
  const header = `// ${relPath}:${startLine}-${endLine}`
  const numWidth = String(endLine).length

  const numbered = lines.map((line, i) => {
    const num = String(startLine + i).padStart(numWidth, ' ')
    return `${num}| ${line}`
  })

  const parts = [header, ...numbered]

  if (remainingLines !== undefined && remainingLines > 0) {
    parts.push(`[truncated, +${remainingLines} more lines]`)
  }

  return parts.join('\n')
}

/**
 * Render a class outline when the class is too large to show in full.
 * Shows all method/property signatures instead of source code.
 */
function renderClassOutline(sym: Symbol, relPath: string): string {
  const lines: string[] = [
    `// ${relPath}:${sym.startLine}-${sym.endLine}`,
    `// Class too large (${sym.endLine - sym.startLine + 1} lines), showing outline:`,
    '',
    sym.signature + ' {',
  ]

  if (sym.children) {
    for (const child of sym.children) {
      const range = child.startLine === child.endLine
        ? `[${child.startLine}]`
        : `[${child.startLine}-${child.endLine}]`
      lines.push(`  ${child.signature}  ${range}`)
    }
  }

  lines.push('}')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createReadSymbolTool(parser: SymbolParser): Tool {
  return {
    name: 'read_symbol',
    description:
      'Read symbol source code by name. Use ClassName.method for methods. Prefer read_batch when reading multiple symbols.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name. For methods use ClassName.methodName',
        },
        path: {
          type: 'string',
          description: 'Limit search to this file (relative to project root)',
        },
        max_lines: {
          type: 'number',
          default: 150,
          description: 'Maximum lines to return before truncation',
        },
      },
      required: ['symbol'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const symbolName = params.symbol as string
        const filePath = params.path as string | undefined
        const maxLines = typeof params.max_lines === 'number' ? params.max_lines : 150

        if (!symbolName) {
          return 'Error: symbol name is required'
        }

        const absPath = filePath ? resolve(ctx.projectRoot, filePath) : undefined
        if (absPath) assertWithinRoot(absPath, ctx.projectRoot)

        const result = await readSymbolContent(
          parser,
          symbolName,
          absPath,
          maxLines,
          ctx.projectRoot,
        )

        return truncateOutput(result, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
