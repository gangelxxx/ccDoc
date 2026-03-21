import picomatch from 'picomatch'
import type { Tool, ToolContext, Symbol, SymbolKind } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { truncateOutput } from '../utils/format.js'

/**
 * Build a display name for a symbol.
 * Methods show as `ClassName.methodName`, top-level symbols show just the name.
 */
function displayName(sym: Symbol): string {
  if (sym.parentName) {
    return `${sym.parentName}.${sym.name}`
  }
  return sym.name
}

/**
 * Format a single symbol as a one-line summary:
 *   Engine (class) -- src/core/engine.ts:32
 */
function formatSymbol(sym: Symbol): string {
  return `${displayName(sym)} (${sym.kind}) \u2014 ${sym.filePath}:${sym.startLine}`
}

/**
 * Collect matching symbols from the symbol index (keyed by symbol name).
 * The index maps symbolName → Symbol[], including dotted keys like "Class.method".
 * We iterate keys, match against pattern, and collect unique symbols.
 */
function collectMatchingSymbols(
  symbolIndex: Map<string, Symbol[]>,
  matchName: (name: string) => boolean,
): Symbol[] {
  const result: Symbol[] = []
  const seen = new Set<string>()

  for (const [key, symbols] of symbolIndex) {
    // For dotted keys like "Engine.start", match against the method name part
    const simpleName = key.includes('.') ? key.split('.', 2)[1] : key
    if (!matchName(simpleName) && !matchName(key)) continue

    for (const sym of symbols) {
      // Deduplicate by file:line
      const id = `${sym.filePath}:${sym.startLine}:${sym.name}`
      if (seen.has(id)) continue
      seen.add(id)

      // For dotted keys, ensure parentName is set
      if (key.includes('.') && !sym.parentName) {
        result.push({ ...sym, parentName: key.split('.', 2)[0] })
      } else {
        result.push(sym)
      }
    }
  }

  return result
}

export function createFindSymbolTool(parser: SymbolParser): Tool {
  return {
    name: 'find_symbol',
    description:
      'Find symbol definitions by name. Use a|b|c to search multiple names at once (e.g. "copy|clipboard|getContent"). Supports /regex/, kind filter, file_glob, exported_only.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name pattern. Use | for OR: "foo|bar|baz". Use /regex/ for regex. Plain text = case-insensitive substring.',
        },
        kind: {
          type: 'string',
          enum: ['function', 'class', 'interface', 'type', 'variable', 'method', 'enum'],
        },
        file_glob: { type: 'string' },
        exported_only: { type: 'boolean', default: false },
        max_results: { type: 'number', default: 50 },
      },
      required: ['name'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const namePattern = params.name as string
        const kind = params.kind as SymbolKind | undefined
        const fileGlob = params.file_glob as string | undefined
        const exportedOnly = params.exported_only === true
        const maxResults = typeof params.max_results === 'number' ? params.max_results : 50

        if (!namePattern) {
          return 'Error: name is required'
        }

        // Build name matcher: /regex/ syntax, a|b|c OR syntax, or case-insensitive substring
        let matchName: (name: string) => boolean
        let isExactMatch: (name: string) => boolean

        if (namePattern.startsWith('/') && namePattern.endsWith('/') && namePattern.length > 2) {
          // Regex mode
          const regexBody = namePattern.slice(1, -1)
          try {
            const re = new RegExp(regexBody, 'i')
            matchName = (n) => re.test(n)
            isExactMatch = (n) => n.toLowerCase() === regexBody.toLowerCase()
          } catch (err) {
            return `Error: invalid regex — ${err instanceof Error ? err.message : String(err)}`
          }
        } else if (namePattern.includes('|')) {
          // OR mode: split on `|`, match each as substring
          const parts = namePattern.split('|').map((p) => p.trim().toLowerCase()).filter(Boolean)
          matchName = (n) => {
            const lower = n.toLowerCase()
            return parts.some((p) => lower.includes(p))
          }
          isExactMatch = (n) => {
            const lower = n.toLowerCase()
            return parts.some((p) => lower === p)
          }
        } else {
          // Simple substring match
          const lowerPattern = namePattern.toLowerCase()
          matchName = (n) => n.toLowerCase().includes(lowerPattern)
          isExactMatch = (n) => n.toLowerCase() === lowerPattern
        }

        // Build file glob matcher
        const fileMatcher = fileGlob ? picomatch(fileGlob) : undefined

        // Get symbol index from parser
        const symbolIndex = await parser.getSymbolIndex(ctx.projectRoot)

        // Collect symbols matching the name pattern
        const allMatched = collectMatchingSymbols(symbolIndex, matchName)

        // Apply additional filters
        const matched = allMatched.filter((sym) => {
          if (kind && sym.kind !== kind) return false
          if (exportedOnly && !sym.exported) return false
          if (fileMatcher && !fileMatcher(sym.filePath)) return false
          return true
        })

        if (matched.length === 0) {
          return `No symbols matching "${namePattern}" found.`
        }

        // Sort: exact name matches first, then alphabetically by file + line
        matched.sort((a, b) => {
          const aExact = isExactMatch(a.name) ? 0 : 1
          const bExact = isExactMatch(b.name) ? 0 : 1
          if (aExact !== bExact) return aExact - bExact

          const fileCmp = a.filePath.localeCompare(b.filePath)
          if (fileCmp !== 0) return fileCmp

          return a.startLine - b.startLine
        })

        // Limit results
        const limited = matched.slice(0, maxResults)
        const lines = limited.map(formatSymbol)

        if (matched.length > maxResults) {
          lines.push(`\n... and ${matched.length - maxResults} more results`)
        }

        return truncateOutput(lines.join('\n'), ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
