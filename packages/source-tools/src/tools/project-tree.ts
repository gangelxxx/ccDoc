import { readdir } from 'fs/promises'
import { join, relative } from 'path'
import picomatch from 'picomatch'
import type { Tool, ToolContext } from './types.js'
import { shouldIgnore, loadGitignore } from '../utils/ignore.js'
import { truncateOutput } from '../utils/format.js'

interface TreeEntry {
  name: string
  isDir: boolean
  children: TreeEntry[]
}

/**
 * Recursively build a sorted tree of directory entries.
 * Directories come first (alphabetical), then files (alphabetical).
 */
async function buildTree(
  dir: string,
  root: string,
  depth: number,
  maxDepth: number,
  globMatcher: picomatch.Matcher | undefined,
  gitignoreMatchers: picomatch.Matcher[] | undefined,
): Promise<TreeEntry[]> {
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const dirs: TreeEntry[] = []
  const files: TreeEntry[] = []

  for (const entry of dirents) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(root, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (shouldIgnore(entry.name)) continue
      if (isGitignored(relPath + '/', gitignoreMatchers)) continue

      const children =
        depth < maxDepth
          ? await buildTree(fullPath, root, depth + 1, maxDepth, globMatcher, gitignoreMatchers)
          : []

      // When glob is active, only include dirs that have matching descendants
      if (globMatcher) {
        if (children.length > 0) {
          dirs.push({ name: entry.name, isDir: true, children })
        }
      } else {
        dirs.push({ name: entry.name, isDir: true, children })
      }
    } else {
      if (isGitignored(relPath, gitignoreMatchers)) continue
      if (globMatcher && !globMatcher(relPath)) continue

      files.push({ name: entry.name, isDir: false, children: [] })
    }
  }

  // Sort directories and files alphabetically (case-insensitive)
  const cmp = (a: TreeEntry, b: TreeEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  dirs.sort(cmp)
  files.sort(cmp)

  return [...dirs, ...files]
}

function isGitignored(
  relPath: string,
  matchers: picomatch.Matcher[] | undefined,
): boolean {
  if (!matchers) return false
  return matchers.some((m) => m(relPath))
}

/**
 * Render tree entries into indented text lines.
 * Directories get a trailing `/`, 2-space indent per level.
 */
function renderTree(entries: TreeEntry[], indent: number): string[] {
  const lines: string[] = []
  const prefix = '  '.repeat(indent)

  for (const entry of entries) {
    if (entry.isDir) {
      lines.push(`${prefix}${entry.name}/`)
      lines.push(...renderTree(entry.children, indent + 1))
    } else {
      lines.push(`${prefix}${entry.name}`)
    }
  }

  return lines
}

export function createProjectTreeTool(): Tool {
  return {
    name: 'project_tree',
    description:
      'Show project file tree. Use glob to filter (e.g. "src/**/*.ts"), max_depth to limit depth. Start here to understand project layout.',
    parameters: {
      type: 'object',
      properties: {
        glob: {
          type: 'string',
          description: 'Glob filter, e.g. src/**/*.ts',
        },
        max_depth: {
          type: 'number',
          description: 'Max directory depth',
          default: 4,
        },
      },
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const glob = params.glob as string | undefined
        const maxDepth = typeof params.max_depth === 'number' ? params.max_depth : 4

        const gitignorePatterns = await loadGitignore(ctx.projectRoot)
        const gitignoreMatchers = gitignorePatterns.length
          ? gitignorePatterns.map((p) => picomatch(p, { dot: true }))
          : undefined

        const globMatcher = glob ? picomatch(glob) : undefined

        const tree = await buildTree(
          ctx.projectRoot,
          ctx.projectRoot,
          0,
          maxDepth,
          globMatcher,
          gitignoreMatchers,
        )

        if (tree.length === 0) {
          return glob
            ? `No files matching "${glob}" found in project.`
            : 'Empty project directory.'
        }

        const lines = renderTree(tree, 0)
        return truncateOutput(lines.join('\n'), ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
