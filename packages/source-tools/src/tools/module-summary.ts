import { existsSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { resolve, relative, join, dirname } from 'path'
import type { Tool, ToolContext, Symbol, Import } from './types.js'
import type { SymbolParser } from '../parser/index.js'
import { countLines } from '../utils/fs.js'
import { shouldIgnore } from '../utils/ignore.js'
import { truncateOutput } from '../utils/format.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileInfo {
  relativePath: string // relative to projectRoot
  localPath: string    // relative to the analyzed directory
  lineCount: number
  exports: Symbol[]
  imports: Import[]
}

interface BarrelReexports {
  names: Set<string>
  sources: string[]
}

// ---------------------------------------------------------------------------
// Barrel file detection
// ---------------------------------------------------------------------------

const BARREL_NAMES = new Set(['index.ts', 'index.tsx', 'index.js', 'index.jsx', '__init__.py'])

/**
 * Check if a file is a barrel (re-export index).
 * A barrel mainly consists of export/re-export statements.
 */
function detectBarrelFile(files: FileInfo[]): FileInfo | undefined {
  return files.find((f) => {
    const basename = f.localPath.split('/').pop() ?? ''
    return BARREL_NAMES.has(basename)
  })
}

/**
 * Extract re-exported symbol names from a barrel file's imports.
 * Barrel files re-export from local modules, so we collect those names.
 */
function getBarrelReexports(barrel: FileInfo): BarrelReexports {
  const names = new Set<string>()
  const sources: string[] = []

  // Barrel exports come from local imports that are then re-exported.
  // We approximate: exported symbols from the barrel itself = public API
  for (const sym of barrel.exports) {
    names.add(sym.name)
  }

  // Also consider import sources as re-export sources
  for (const imp of barrel.imports) {
    if (!imp.isExternal) {
      sources.push(imp.source)
      for (const name of imp.names) {
        // Namespace imports are re-exported as the namespace
        names.add(name.replace(/^\* as /, ''))
      }
    }
  }

  return { names, sources }
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Recursively collect files in a directory up to a given depth.
 */
async function collectFiles(
  dir: string,
  projectRoot: string,
  baseDir: string,
  currentDepth: number,
  maxDepth: number,
): Promise<string[]> {
  const files: string[] = []

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return files
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (shouldIgnore(entry.name)) continue
      if (currentDepth < maxDepth) {
        const nested = await collectFiles(fullPath, projectRoot, baseDir, currentDepth + 1, maxDepth)
        files.push(...nested)
      }
    } else {
      files.push(relative(projectRoot, fullPath).replace(/\\/g, '/'))
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// External dependency detection
// ---------------------------------------------------------------------------

/**
 * Check if an import source points outside the analyzed directory.
 */
function isExternalToDir(
  importSource: string,
  importerPath: string,
  dirRelPath: string,
  projectRoot: string,
): boolean {
  // Absolute/package imports are always external
  if (!importSource.startsWith('.')) return true

  // Resolve the import to a project-relative path
  const importerAbsPath = resolve(projectRoot, importerPath)
  const importerDir = dirname(importerAbsPath)
  const resolvedAbs = resolve(importerDir, importSource)
  const resolvedRel = relative(projectRoot, resolvedAbs).replace(/\\/g, '/')

  const dirPrefix = dirRelPath.endsWith('/') ? dirRelPath : dirRelPath + '/'

  // If resolved path doesn't start with the directory prefix, it's external
  return !resolvedRel.startsWith(dirPrefix) && resolvedRel !== dirRelPath
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

async function analyzeModule(
  dirPath: string,
  parser: SymbolParser,
  projectRoot: string,
  depth: number,
): Promise<{
  files: FileInfo[]
  totalLines: number
  publicApi: Symbol[]
  dependsOn: Map<string, string[]>
  importedBy: string[]
}> {
  const absDir = resolve(projectRoot, dirPath)
  const dirRelPath = relative(projectRoot, absDir).replace(/\\/g, '/')
  const dirPrefix = dirRelPath.endsWith('/') ? dirRelPath : dirRelPath + '/'

  // Collect all files in the directory
  const filePaths = await collectFiles(absDir, projectRoot, absDir, 0, depth)

  // Parse each file
  const files: FileInfo[] = []
  let totalLines = 0

  for (const filePath of filePaths) {
    const absPath = resolve(projectRoot, filePath)
    const localPath = relative(absDir, absPath).replace(/\\/g, '/')

    let content: string
    try {
      content = await readFile(absPath, 'utf-8')
    } catch {
      continue
    }

    let lineCount: number
    try {
      lineCount = await countLines(absPath)
    } catch {
      lineCount = content.split('\n').length
    }

    totalLines += lineCount

    let symbols: Symbol[]
    let imports: Import[]
    try {
      const parsed = parser.parseFile(filePath, content)
      symbols = parsed.symbols
      imports = parsed.imports
    } catch {
      symbols = []
      imports = []
    }

    files.push({
      relativePath: filePath,
      localPath,
      lineCount,
      exports: symbols.filter((s) => s.exported),
      imports,
    })
  }

  // Determine public API
  const barrel = detectBarrelFile(files)
  let publicApi: Symbol[]

  if (barrel) {
    // Use barrel exports as the public API
    const reexports = getBarrelReexports(barrel)
    publicApi = []

    // Collect all exported symbols from all files, filter by barrel re-export names
    for (const file of files) {
      for (const sym of file.exports) {
        if (reexports.names.has(sym.name)) {
          publicApi.push(sym)
        }
      }
    }

    // If barrel re-exports everything and our heuristic missed, fall back to all exports
    if (publicApi.length === 0) {
      for (const file of files) {
        publicApi.push(...file.exports)
      }
    }
  } else {
    // No barrel: all exports are public
    publicApi = []
    for (const file of files) {
      publicApi.push(...file.exports)
    }
  }

  // DEPENDS ON: imports from outside this directory
  const dependsOn = new Map<string, string[]>()

  for (const file of files) {
    for (const imp of file.imports) {
      if (isExternalToDir(imp.source, file.relativePath, dirRelPath, projectRoot)) {
        // Try to resolve the actual path for display
        let displaySource = imp.source
        if (imp.source.startsWith('.')) {
          const importerDir = dirname(resolve(projectRoot, file.relativePath))
          const resolvedAbs = resolve(importerDir, imp.source)
          displaySource = relative(projectRoot, resolvedAbs).replace(/\\/g, '/')
        }

        let importers = dependsOn.get(displaySource)
        if (!importers) {
          importers = []
          dependsOn.set(displaySource, importers)
        }
        if (!importers.includes(file.localPath)) {
          importers.push(file.localPath)
        }
      }
    }
  }

  // IMPORTED BY: files outside the directory that import from it
  const importedBy: string[] = []

  try {
    const importIndex = await parser.getImportIndex(projectRoot)

    for (const [filePath, imports] of importIndex) {
      // Skip files within the directory
      if (filePath.startsWith(dirPrefix) || filePath === dirRelPath) continue

      for (const imp of imports) {
        if (imp.isExternal) continue

        // Resolve the import target
        const importerDir = dirname(resolve(projectRoot, filePath))
        const resolvedAbs = resolve(importerDir, imp.source)
        const resolvedRel = relative(projectRoot, resolvedAbs).replace(/\\/g, '/')

        // Check if it points into our directory
        if (resolvedRel.startsWith(dirPrefix) || resolvedRel === dirRelPath) {
          if (!importedBy.includes(filePath)) {
            importedBy.push(filePath)
          }
          break // One import is enough to flag this file
        }
      }
    }
  } catch {
    // Import index may not be available — skip imported-by section
  }

  importedBy.sort()

  return { files, totalLines, publicApi, dependsOn, importedBy }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatModuleSummary(
  dirRelPath: string,
  files: FileInfo[],
  totalLines: number,
  publicApi: Symbol[],
  dependsOn: Map<string, string[]>,
  importedBy: string[],
): string {
  const lines: string[] = []

  lines.push(`=== ${dirRelPath}/ (${files.length} files, ${totalLines} lines) ===`)
  lines.push('')

  // PUBLIC API
  if (publicApi.length > 0) {
    lines.push('PUBLIC API:')
    // Sort by file, then line number
    const sorted = [...publicApi].sort((a, b) => {
      const fileComp = a.filePath.localeCompare(b.filePath)
      if (fileComp !== 0) return fileComp
      return a.startLine - b.startLine
    })

    for (const sym of sorted) {
      const fileLocal = sym.filePath.split('/').pop() ?? sym.filePath
      lines.push(`  ${sym.name} (${sym.kind}) — ${fileLocal}:${sym.startLine}`)
    }
    lines.push('')
  }

  // FILES
  if (files.length > 0) {
    lines.push('FILES:')
    // Sort files by local path
    const sorted = [...files].sort((a, b) => a.localPath.localeCompare(b.localPath))

    for (const file of sorted) {
      const basename = file.localPath.split('/').pop() ?? file.localPath
      const isBarrel = BARREL_NAMES.has(basename)

      // Brief description: main exported symbol names
      let description: string
      if (isBarrel) {
        description = 'barrel export'
      } else if (file.exports.length > 0) {
        const names = file.exports
          .slice(0, 4)
          .map((s) => s.name)
          .join(', ')
        const more = file.exports.length > 4 ? `, +${file.exports.length - 4} more` : ''
        description = names + more
      } else {
        description = 'no exports'
      }

      lines.push(`  ${file.localPath} (${file.lineCount} lines) — ${description}`)
    }
    lines.push('')
  }

  // DEPENDS ON
  if (dependsOn.size > 0) {
    lines.push('DEPENDS ON:')
    const sortedDeps = [...dependsOn.entries()].sort(([a], [b]) => a.localeCompare(b))

    for (const [dep, importers] of sortedDeps) {
      lines.push(`  ${dep} ← ${importers.join(', ')}`)
    }
    lines.push('')
  }

  // IMPORTED BY
  if (importedBy.length > 0) {
    lines.push('IMPORTED BY:')
    for (const file of importedBy) {
      lines.push(`  ${file}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createModuleSummaryTool(parser: SymbolParser): Tool {
  return {
    name: 'module_summary',
    description:
      'Summarize a directory: public API, files, dependencies, importers. Use BEFORE exploring individual files in a module. Detects barrel exports (index.ts).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to project root',
        },
        depth: {
          type: 'number',
          default: 1,
          description: 'How deep to recurse into subdirectories',
        },
      },
      required: ['path'],
    },

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      try {
        const dirPath = params.path as string
        const depth = typeof params.depth === 'number' ? params.depth : 1

        if (!dirPath) {
          return 'Error: path is required'
        }

        const absDir = resolve(ctx.projectRoot, dirPath)

        // Verify it's a directory
        let stats
        try {
          stats = await stat(absDir)
        } catch {
          return `Error: path "${dirPath}" not found`
        }

        if (!stats.isDirectory()) {
          return `Error: "${dirPath}" is not a directory. Use file_outline for files.`
        }

        const dirRelPath = relative(ctx.projectRoot, absDir).replace(/\\/g, '/')

        const { files, totalLines, publicApi, dependsOn, importedBy } =
          await analyzeModule(dirPath, parser, ctx.projectRoot, depth)

        if (files.length === 0) {
          return `No source files found in "${dirPath}".`
        }

        const output = formatModuleSummary(
          dirRelPath,
          files,
          totalLines,
          publicApi,
          dependsOn,
          importedBy,
        )

        return truncateOutput(output, ctx.maxOutputChars)
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  }
}
