import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { resolve, relative, dirname } from 'path'
import type { Tool, ToolContext, Import } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { assertWithinRoot } from '../utils/fs.js'
import { truncateOutput } from '../utils/format.js'

// ---------------------------------------------------------------------------
// Import path resolution
// ---------------------------------------------------------------------------

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const INDEX_SUFFIXES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']

/**
 * Resolve a relative import source to a project-relative file path.
 * Returns null for external (non-relative) imports.
 *
 * Tries common extensions and index files in order:
 *   ./foo → foo.ts, foo.tsx, foo.js, foo.jsx, foo/index.ts, foo/index.js, ...
 */
function resolveImportPath(
  importSource: string,
  importerPath: string,
  projectRoot: string,
): string | null {
  // Skip external packages (no leading dot)
  if (!importSource.startsWith('.')) return null

  const importerAbsPath = resolve(projectRoot, importerPath)
  const importerDir = dirname(importerAbsPath)
  const base = resolve(importerDir, importSource)

  // Try direct file with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    if (existsSync(base + ext)) {
      return relative(projectRoot, base + ext).replace(/\\/g, '/')
    }
  }

  // Try index files in directory
  for (const suffix of INDEX_SUFFIXES) {
    if (existsSync(base + suffix)) {
      return relative(projectRoot, base + suffix).replace(/\\/g, '/')
    }
  }

  // Try exact path (e.g., .json, .css imports)
  if (existsSync(base)) {
    return relative(projectRoot, base).replace(/\\/g, '/')
  }

  return null
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

interface DependencyEdge {
  from: string // importer (project-relative)
  to: string   // dependency (project-relative)
}

/**
 * Build a dependency graph starting from entry files.
 * Returns edges and all visited files.
 */
async function buildDependencyGraph(
  entryFiles: string[],
  parser: SymbolParser,
  projectRoot: string,
  maxDepth: number,
): Promise<{ edges: DependencyEdge[]; visited: Set<string> }> {
  const importIndex = await parser.getImportIndex(projectRoot)
  const edges: DependencyEdge[] = []
  const visited = new Set<string>()

  // BFS traversal with depth tracking
  let currentLevel = new Set(entryFiles)
  let depth = 0

  while (currentLevel.size > 0 && depth < maxDepth) {
    const nextLevel = new Set<string>()

    for (const filePath of currentLevel) {
      if (visited.has(filePath)) continue
      visited.add(filePath)

      const imports = importIndex.get(filePath)
      if (!imports) continue

      for (const imp of imports) {
        const resolved = resolveImportPath(imp.source, filePath, projectRoot)
        if (!resolved) continue

        edges.push({ from: filePath, to: resolved })

        if (!visited.has(resolved)) {
          nextLevel.add(resolved)
        }
      }
    }

    currentLevel = nextLevel
    depth++
  }

  return { edges, visited }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * Format in "flat" mode: each file → its dependencies.
 */
function formatFlat(
  entryFiles: string[],
  edges: DependencyEdge[],
): string {
  // Group edges by source file
  const groups = new Map<string, string[]>()

  for (const edge of edges) {
    let deps = groups.get(edge.from)
    if (!deps) {
      deps = []
      groups.set(edge.from, deps)
    }
    deps.push(edge.to)
  }

  const lines: string[] = []

  // Show entry files first, then remaining files sorted
  const orderedFiles = [
    ...entryFiles.filter((f) => groups.has(f)),
    ...[...groups.keys()].filter((f) => !entryFiles.includes(f)).sort(),
  ]

  for (const file of orderedFiles) {
    const deps = groups.get(file)
    if (!deps || deps.length === 0) continue

    const uniqueDeps = [...new Set(deps)].sort()
    lines.push(`${file} → ${uniqueDeps.join(', ')}`)
  }

  if (lines.length === 0) {
    return 'No internal dependencies found.'
  }

  return lines.join('\n')
}

/**
 * Format in "reverse" mode: each file ← who imports it.
 */
function formatReverse(
  edges: DependencyEdge[],
): string {
  // Group edges by target file
  const groups = new Map<string, string[]>()

  for (const edge of edges) {
    let importers = groups.get(edge.to)
    if (!importers) {
      importers = []
      groups.set(edge.to, importers)
    }
    importers.push(edge.from)
  }

  const lines: string[] = []

  const sortedTargets = [...groups.keys()].sort()
  for (const target of sortedTargets) {
    const importers = [...new Set(groups.get(target)!)].sort()
    lines.push(`${target} ← imported by:`)
    for (const imp of importers) {
      lines.push(`  ${imp}`)
    }
  }

  if (lines.length === 0) {
    return 'No internal dependents found.'
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Entry resolution
// ---------------------------------------------------------------------------

/**
 * Collect all files that should serve as entry points.
 * If entry is a file, returns that file.
 * If entry is a directory, returns all files from the import index within that dir.
 */
async function resolveEntryFiles(
  entry: string | undefined,
  parser: SymbolParser,
  projectRoot: string,
): Promise<string[]> {
  if (!entry) {
    // No entry specified — use all files in the project
    const importIndex = await parser.getImportIndex(projectRoot)
    return [...importIndex.keys()]
  }

  const absEntry = resolve(projectRoot, entry)
  assertWithinRoot(absEntry, projectRoot)
  const relEntry = relative(projectRoot, absEntry).replace(/\\/g, '/')

  let stats
  try {
    stats = await stat(absEntry)
  } catch {
    return []
  }

  if (stats.isFile()) {
    return [relEntry]
  }

  if (stats.isDirectory()) {
    const importIndex = await parser.getImportIndex(projectRoot)
    const prefix = relEntry.endsWith('/') ? relEntry : relEntry + '/'
    const files: string[] = []

    for (const filePath of importIndex.keys()) {
      if (filePath.startsWith(prefix) || filePath === relEntry) {
        files.push(filePath)
      }
    }

    return files
  }

  return []
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDependencyGraphTool(parser: SymbolParser): Tool {
  return {
    name: 'dependency_graph',
    description:
      'Show import graph for a file or directory. "flat" mode: file → deps. "reverse" mode: file ← importers. Skips external packages.',
    parameters: {
      type: 'object',
      properties: {
        entry: {
          type: 'string',
          description: 'File or directory to analyze (relative to project root). If omitted, analyzes the entire project.',
        },
        depth: {
          type: 'number',
          default: 3,
          description: 'Maximum depth for dependency traversal',
        },
        mode: {
          type: 'string',
          enum: ['flat', 'reverse'],
          default: 'flat',
          description: '"flat" = file → dependencies, "reverse" = file ← importers',
        },
      },
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const entry = params.entry as string | undefined
        const depth = typeof params.depth === 'number' ? params.depth : 3
        const mode = (params.mode as 'flat' | 'reverse') || 'flat'

        const entryFiles = await resolveEntryFiles(entry, parser, ctx.projectRoot)

        if (entryFiles.length === 0) {
          const target = entry ?? 'project'
          return `No source files found in "${target}".`
        }

        const { edges } = await buildDependencyGraph(
          entryFiles,
          parser,
          ctx.projectRoot,
          depth,
        )

        const output = mode === 'reverse'
          ? formatReverse(edges)
          : formatFlat(entryFiles, edges)

        return truncateOutput(output, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
