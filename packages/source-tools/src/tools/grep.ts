import { readFile } from 'fs/promises'
import picomatch from 'picomatch'
import type { Tool, ToolContext } from './types.js'
import { walkDir } from '../utils/fs.js'
import { IGNORED_DIRS, loadGitignore } from '../utils/ignore.js'
import { truncateOutput } from '../utils/format.js'

type GrepMode = 'content' | 'files' | 'count'

interface GrepMatch {
  lineNo: number
  content: string
  isMatch: boolean // true for matching line, false for context line
}

interface FileMatches {
  relativePath: string
  matches: GrepMatch[]
  matchCount: number
}

/**
 * Check if a buffer looks like a binary file by scanning the first 512 bytes
 * for null bytes.
 */
function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 512)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/**
 * Count matches in a file without collecting context (fast path for files/count modes).
 */
function countMatches(
  lines: string[],
  testFn: (line: string) => boolean,
  earlyExit: boolean,
): number {
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    if (testFn(lines[i])) {
      count++
      if (earlyExit) return count
    }
  }
  return count
}

/**
 * Search lines for pattern matches and collect context lines.
 */
function searchLines(
  lines: string[],
  testFn: (line: string) => boolean,
  contextLines: number,
): { matches: GrepMatch[]; matchCount: number } {
  const matchIndices: number[] = []

  for (let i = 0; i < lines.length; i++) {
    if (testFn(lines[i])) {
      matchIndices.push(i)
    }
  }

  if (matchIndices.length === 0) {
    return { matches: [], matchCount: 0 }
  }

  // Build set of lines to include (match + context), preserving order
  const includedLines = new Map<number, boolean>() // index -> isMatch

  for (const idx of matchIndices) {
    const ctxStart = Math.max(0, idx - contextLines)
    const ctxEnd = Math.min(lines.length - 1, idx + contextLines)

    for (let i = ctxStart; i <= ctxEnd; i++) {
      // Don't downgrade a match line to context
      if (!includedLines.has(i)) {
        includedLines.set(i, i === idx)
      } else if (i === idx) {
        includedLines.set(i, true)
      }
    }
  }

  // Convert to sorted array of GrepMatch
  const sortedIndices = [...includedLines.keys()].sort((a, b) => a - b)
  const matches: GrepMatch[] = sortedIndices.map((idx) => ({
    lineNo: idx + 1, // 1-based
    content: lines[idx],
    isMatch: includedLines.get(idx)!,
  }))

  return { matches, matchCount: matchIndices.length }
}

/**
 * Format matches for "content" mode output.
 * Matching lines use `:` separator, context lines use `-`.
 * Non-contiguous groups are separated by blank lines.
 */
function formatContentMatches(fileMatches: FileMatches[]): string {
  const blocks: string[] = []

  for (const fm of fileMatches) {
    const lines: string[] = [fm.relativePath]

    for (let i = 0; i < fm.matches.length; i++) {
      const m = fm.matches[i]

      // Insert blank line for non-contiguous groups
      if (i > 0 && m.lineNo > fm.matches[i - 1].lineNo + 1) {
        lines.push('')
      }

      const sep = m.isMatch ? ':' : '-'
      lines.push(`  ${m.lineNo}${sep}   ${m.content}`)
    }

    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}

export function createGrepTool(): Tool {
  return {
    name: 'grep',
    description:
      'Search file contents. Use a|b|c for multiple patterns at once (e.g. "getContent|exportSection|markdown"). Modes: content (with context), files (paths only), count (summary).',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern. Use | for OR: "foo|bar|baz". Set is_regex=true for full regex.' },
        is_regex: { type: 'boolean', default: false },
        include: {
          type: 'string',
          description: 'Glob pattern to include files',
        },
        exclude: {
          type: 'string',
          description: 'Glob pattern to exclude files',
        },
        context_lines: { type: 'number', default: 1, maximum: 5 },
        mode: {
          type: 'string',
          enum: ['content', 'files', 'count'],
          default: 'content',
        },
        max_results: { type: 'number', default: 30 },
      },
      required: ['pattern'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const pattern = params.pattern as string
        const isRegex = params.is_regex === true
        const include = params.include as string | undefined
        const exclude = params.exclude as string | undefined
        const contextLines = typeof params.context_lines === 'number'
          ? Math.min(params.context_lines, 5)
          : 1
        const mode = (params.mode as GrepMode) || 'content'
        const maxResults = typeof params.max_results === 'number' ? params.max_results : 30

        if (!pattern) {
          return 'Error: pattern is required'
        }

        // Build test function
        let testFn: (line: string) => boolean
        if (isRegex) {
          try {
            const re = new RegExp(pattern, 'i')
            testFn = (line) => re.test(line)
          } catch (err) {
            return `Error: invalid regex — ${err instanceof Error ? err.message : String(err)}`
          }
        } else if (pattern.includes('|')) {
          // OR mode: split on `|`, match each as substring
          const parts = pattern.split('|').map((p) => p.trim().toLowerCase()).filter(Boolean)
          testFn = (line) => {
            const lower = line.toLowerCase()
            return parts.some((p) => lower.includes(p))
          }
        } else {
          const lowerPattern = pattern.toLowerCase()
          testFn = (line) => line.toLowerCase().includes(lowerPattern)
        }

        // Build glob matchers
        const includeMatcher = include ? picomatch(include) : undefined
        const excludeMatcher = exclude ? picomatch(exclude) : undefined

        const gitignorePatterns = await loadGitignore(ctx.projectRoot)

        const allFileMatches: FileMatches[] = []
        let totalMatchCount = 0
        let totalFileCount = 0

        for await (const entry of walkDir(ctx.projectRoot, {
          ignore: IGNORED_DIRS,
          gitignorePatterns,
        })) {
          if (entry.isDir) continue

          // Apply include/exclude filters
          if (includeMatcher && !includeMatcher(entry.relativePath)) continue
          if (excludeMatcher && excludeMatcher(entry.relativePath)) continue

          // Read file, skip binary
          let buf: Buffer
          try {
            buf = await readFile(entry.path)
          } catch {
            continue // permission denied, etc.
          }

          if (isBinary(buf)) continue

          const content = buf.toString('utf-8')
          const lines = content.split('\n')

          // Fast path: files/count modes don't need context lines
          if (mode === 'files' || mode === 'count') {
            const matchCount = countMatches(lines, testFn, false)
            if (matchCount === 0) continue

            totalMatchCount += matchCount
            totalFileCount++

            if (mode === 'files') {
              allFileMatches.push({
                relativePath: entry.relativePath,
                matches: [],
                matchCount,
              })
              if (allFileMatches.length >= maxResults) break
            }
            continue
          }

          // Content mode: full search with context
          const { matches, matchCount } = searchLines(lines, testFn, contextLines)
          if (matchCount === 0) continue

          totalMatchCount += matchCount
          totalFileCount++

          allFileMatches.push({
            relativePath: entry.relativePath,
            matches,
            matchCount,
          })

          if (allFileMatches.length >= maxResults) break
        }

        if (totalMatchCount === 0) {
          return `No matches found for "${pattern}".`
        }

        // Format based on mode
        let output: string
        switch (mode) {
          case 'count':
            output = `${totalMatchCount} matches in ${totalFileCount} files`
            break

          case 'files':
            output = allFileMatches
              .map((fm) => `${fm.relativePath} (${fm.matchCount} matches)`)
              .join('\n')
            break

          case 'content':
          default:
            output = formatContentMatches(allFileMatches)
            break
        }

        return truncateOutput(output, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
