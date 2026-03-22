import { readFile } from 'fs/promises'
import { resolve, relative } from 'path'
import type { Tool, ToolContext, Symbol } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { walkDir, assertWithinRoot } from '../utils/fs.js'
import { IGNORED_DIRS, loadGitignore } from '../utils/ignore.js'
import { truncateOutput } from '../utils/format.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Reference {
  filePath: string
  line: number
  content: string
  kind: 'import' | 'usage'
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

/**
 * Check if a line is a comment (simple heuristic for common languages).
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  )
}

/**
 * Check if the match position is inside a string literal.
 * Heuristic: count unescaped quotes before the match position.
 * If an odd number of quotes precede the match, it's likely inside a string.
 */
function isInsideString(line: string, matchIndex: number): boolean {
  let singleQuotes = 0
  let doubleQuotes = 0
  let backticks = 0

  for (let i = 0; i < matchIndex; i++) {
    if (line[i] === '\\') {
      i++ // skip escaped char
      continue
    }
    if (line[i] === "'") singleQuotes++
    else if (line[i] === '"') doubleQuotes++
    else if (line[i] === '`') backticks++
  }

  // If any quote type has an odd count, the position is likely inside that string
  return singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0
}

/**
 * Classify a reference line as import or usage.
 */
function classifyReference(line: string, symbolName: string): 'import' | 'usage' {
  const trimmed = line.trimStart()
  // Common import patterns across languages
  if (
    trimmed.startsWith('import ') ||
    trimmed.startsWith('from ') ||
    /^\s*const\s+\{.*\}\s*=\s*require\(/.test(line)
  ) {
    return 'import'
  }
  return 'usage'
}

/**
 * Check if a buffer looks binary by scanning for null bytes.
 */
function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 512)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Core search
// ---------------------------------------------------------------------------

async function findReferences(
  parser: SymbolParser,
  symbolName: string,
  definitionPath: string | undefined,
  maxResults: number,
  ctx: ToolContext,
): Promise<{ refs: Reference[]; definitionFile: string | undefined }> {
  // Determine the definition file
  let defFile: string | undefined = definitionPath

  if (!defFile) {
    // Look up symbol by name in the index (keyed by symbol name, not file path)
    const symbolIndex = await parser.getSymbolIndex(ctx.projectRoot)
    const candidates = symbolIndex.get(symbolName)
    if (candidates && candidates.length > 0) {
      defFile = candidates[0].filePath
    }
  }

  const defFileNormalized = defFile?.replace(/\\/g, '/')

  // Build word-boundary regex for accurate matching
  const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const symbolRegex = new RegExp(`\\b${escapedName}\\b`, 'g')

  const gitignorePatterns = await loadGitignore(ctx.projectRoot)
  const refs: Reference[] = []

  for await (const entry of walkDir(ctx.projectRoot, {
    ignore: IGNORED_DIRS,
    gitignorePatterns,
  })) {
    if (entry.isDir) continue

    // Skip the definition file itself
    if (defFileNormalized && entry.relativePath === defFileNormalized) continue

    // Read file
    let buf: Buffer
    try {
      buf = await readFile(entry.path) as unknown as Buffer
    } catch {
      continue
    }

    if (isBinary(buf)) continue

    const content = buf.toString('utf-8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      symbolRegex.lastIndex = 0

      const match = symbolRegex.exec(line)
      if (!match) continue

      // Filter: skip comment lines
      if (isCommentLine(line)) continue

      // Filter: skip matches inside string literals
      if (isInsideString(line, match.index)) continue

      const kind = classifyReference(line, symbolName)

      refs.push({
        filePath: entry.relativePath,
        line: i + 1,
        content: line.trim(),
        kind,
      })

      if (refs.length >= maxResults) break
    }

    if (refs.length >= maxResults) break
  }

  return { refs, definitionFile: defFile }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatReferences(
  symbolName: string,
  refs: Reference[],
  definitionFile: string | undefined,
): string {
  if (refs.length === 0) {
    const where = definitionFile ? ` (defined in ${definitionFile})` : ''
    return `No references found for "${symbolName}"${where}.`
  }

  // Sort: imports first, then usages, within each group by file then line
  refs.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'import' ? -1 : 1
    const fileComp = a.filePath.localeCompare(b.filePath)
    if (fileComp !== 0) return fileComp
    return a.line - b.line
  })

  const lines: string[] = []
  lines.push(`${symbolName} — ${refs.length} references:`)

  // Find longest file:line for alignment
  let maxPathLen = 0
  for (const ref of refs) {
    const pathLine = `${ref.filePath}:${ref.line}`
    if (pathLine.length > maxPathLen) maxPathLen = pathLine.length
  }

  for (const ref of refs) {
    const pathLine = `${ref.filePath}:${ref.line}`
    const padding = ' '.repeat(Math.max(1, maxPathLen - pathLine.length + 1))

    // Show a marker for import lines
    const marker = ref.kind === 'import' ? 'import ' : ''
    const content = ref.content.length > 100
      ? ref.content.slice(0, 97) + '...'
      : ref.content

    lines.push(`  ${pathLine}${padding}${marker}${content}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createFindReferencesTool(parser: SymbolParser): Tool {
  return {
    name: 'find_references',
    description:
      'Find all imports and usages of a symbol across the project. Filters comments and string literals. Set path to skip the definition file.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'The symbol name to search for',
        },
        path: {
          type: 'string',
          description: 'File where the symbol is defined (helps skip it in results)',
        },
        max_results: {
          type: 'number',
          default: 30,
          description: 'Maximum number of references to return',
        },
      },
      required: ['symbol'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const symbolName = params.symbol as string
        const filePath = params.path as string | undefined
        const maxResults = typeof params.max_results === 'number' ? params.max_results : 30

        if (!symbolName) {
          return 'Error: symbol name is required'
        }

        let defPath: string | undefined
        if (filePath) {
          const absDefPath = resolve(ctx.projectRoot, filePath)
          assertWithinRoot(absDefPath, ctx.projectRoot)
          defPath = relative(ctx.projectRoot, absDefPath).replace(/\\/g, '/')
        }

        const { refs, definitionFile } = await findReferences(
          parser,
          symbolName,
          defPath,
          maxResults,
          ctx,
        )

        const output = formatReferences(symbolName, refs, definitionFile)
        return truncateOutput(output, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
