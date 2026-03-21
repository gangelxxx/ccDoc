import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'
import picomatch from 'picomatch'
import { shouldIgnore } from './ignore.js'

export interface WalkEntry {
  path: string
  relativePath: string
  isDir: boolean
}

interface WalkOptions {
  ignore: Set<string>
  gitignorePatterns?: string[]
  glob?: string
  maxDepth?: number
}

/**
 * Recursive directory walk with filtering.
 *
 * Skips directories in `ignore` set and directories matching gitignore patterns.
 * When `glob` is provided, only yields files matching the pattern.
 * `maxDepth` limits recursion depth (0 = root only).
 */
export async function* walkDir(
  root: string,
  opts: WalkOptions,
): AsyncGenerator<WalkEntry> {
  const globMatcher = opts.glob ? picomatch(opts.glob) : undefined
  const gitignoreMatchers = opts.gitignorePatterns?.length
    ? opts.gitignorePatterns.map((p) => picomatch(p, { dot: true }))
    : undefined

  yield* walkRecursive(root, root, opts.ignore, globMatcher, gitignoreMatchers, 0, opts.maxDepth)
}

async function* walkRecursive(
  dir: string,
  root: string,
  ignore: Set<string>,
  globMatcher: picomatch.Matcher | undefined,
  gitignoreMatchers: picomatch.Matcher[] | undefined,
  depth: number,
  maxDepth: number | undefined,
): AsyncGenerator<WalkEntry> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // Permission denied or path disappeared -- skip silently
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(root, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (shouldIgnore(entry.name) || ignore.has(entry.name)) continue
      if (isGitignored(relPath, gitignoreMatchers)) continue

      yield { path: fullPath, relativePath: relPath, isDir: true }

      if (maxDepth === undefined || depth < maxDepth) {
        yield* walkRecursive(fullPath, root, ignore, globMatcher, gitignoreMatchers, depth + 1, maxDepth)
      }
    } else {
      if (isGitignored(relPath, gitignoreMatchers)) continue
      if (globMatcher && !globMatcher(relPath)) continue

      yield { path: fullPath, relativePath: relPath, isDir: false }
    }
  }
}

function isGitignored(
  relPath: string,
  matchers: picomatch.Matcher[] | undefined,
): boolean {
  if (!matchers) return false
  return matchers.some((m) => m(relPath))
}

/**
 * Read lines from a file in range [start, end] (1-based, inclusive).
 * Returns the requested lines or fewer if the file is shorter.
 */
export async function readLines(
  filePath: string,
  start: number,
  end: number,
): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8')
  const lines = content.split('\n')

  // Clamp to valid range (1-based → 0-based)
  const from = Math.max(0, start - 1)
  const to = Math.min(lines.length, end)

  return lines.slice(from, to)
}

/**
 * Count the number of lines in a file without loading entire content into
 * a split array — still reads the full file but avoids an extra array allocation.
 */
export async function countLines(filePath: string): Promise<number> {
  const content = await readFile(filePath, 'utf-8')
  if (content.length === 0) return 0

  let count = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++ // \n
  }
  return count
}
