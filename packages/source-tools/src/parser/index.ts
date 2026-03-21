import { extname } from 'path'
import { readFile } from 'fs/promises'
import { parseCode, getLanguageForExt } from './languages.js'
import {
  extractSymbols as extractTSSymbols,
  extractImports as extractTSImports,
} from './extractors/typescript.js'
import {
  extractSymbols as extractPySymbols,
  extractImports as extractPyImports,
} from './extractors/python.js'
import {
  extractSymbols as extractRsSymbols,
  extractImports as extractRsImports,
} from './extractors/rust.js'
import {
  extractSymbols as extractGoSymbols,
  extractImports as extractGoImports,
} from './extractors/go.js'
import type { Symbol, Import } from '../tools/types.js'
import { walkDir } from '../utils/fs.js'
import { IGNORED_DIRS, loadGitignore } from '../utils/ignore.js'

interface ParseResult {
  symbols: Symbol[]
  imports: Import[]
}

type Extractor = {
  symbols: (tree: import('tree-sitter').Tree, filePath: string) => Symbol[]
  imports: (tree: import('tree-sitter').Tree, filePath: string) => Import[]
}

/** Language → extractor dispatch table */
const EXTRACTORS: Record<string, Extractor> = {
  typescript: { symbols: extractTSSymbols, imports: extractTSImports },
  tsx: { symbols: extractTSSymbols, imports: extractTSImports },
  javascript: { symbols: extractTSSymbols, imports: extractTSImports },
  python: { symbols: extractPySymbols, imports: extractPyImports },
  rust: { symbols: extractRsSymbols, imports: extractRsImports },
  go: { symbols: extractGoSymbols, imports: extractGoImports },
}

/** Supported file extensions for symbol parsing */
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go',
])

/**
 * Facade for parsing source files and extracting symbols/imports.
 *
 * Holds per-project caches so repeated lookups are fast.
 * Create one instance per project root.
 */
export class SymbolParser {
  private symbolIndex: Map<string, Symbol[]> | undefined
  private importIndex: Map<string, Import[]> | undefined
  private fileIndex: Map<string, { lines: number; symbols: Symbol[]; imports: Import[] }> | undefined

  /**
   * Parse a single file and extract symbols + imports.
   * Uses cached results from fileIndex when available.
   * Returns empty arrays if the language is unsupported or parsing fails.
   */
  parseFile(filePath: string, content: string): ParseResult {
    // Check fileIndex cache first (avoids re-parsing files already indexed)
    if (this.fileIndex) {
      const cached = this.fileIndex.get(filePath)
      if (cached) {
        return { symbols: cached.symbols, imports: cached.imports }
      }
    }

    const tree = parseCode(content, filePath)
    if (!tree) return { symbols: [], imports: [] }

    const ext = extname(filePath)
    const lang = getLanguageForExt(ext)
    if (!lang) return { symbols: [], imports: [] }

    const extractor = EXTRACTORS[lang]
    if (!extractor) return { symbols: [], imports: [] }

    try {
      return {
        symbols: extractor.symbols(tree, filePath),
        imports: extractor.imports(tree, filePath),
      }
    } catch (err) {
      console.warn(`[SymbolParser] Failed to extract from ${filePath}:`, err)
      return { symbols: [], imports: [] }
    }
  }

  /**
   * Get a symbol index for the entire project.
   * Maps symbol name → array of Symbol (multiple files may define the same name).
   * Builds the index on first call, then caches.
   */
  async getSymbolIndex(projectRoot: string): Promise<Map<string, Symbol[]>> {
    if (this.symbolIndex) return this.symbolIndex
    await this.buildIndices(projectRoot)
    return this.symbolIndex!
  }

  /**
   * Get an import index for the entire project.
   * Maps relative file path → array of Import.
   * Builds the index on first call, then caches.
   */
  async getImportIndex(projectRoot: string): Promise<Map<string, Import[]>> {
    if (this.importIndex) return this.importIndex
    await this.buildIndices(projectRoot)
    return this.importIndex!
  }

  /**
   * Get per-file metadata (line counts, symbols, imports).
   * Builds the index on first call, then caches.
   */
  async getFileIndex(projectRoot: string): Promise<Map<string, { lines: number; symbols: Symbol[]; imports: Import[] }>> {
    if (this.fileIndex) return this.fileIndex
    await this.buildIndices(projectRoot)
    return this.fileIndex!
  }

  /** Clear cached indices. Call when project files change significantly. */
  invalidate(): void {
    this.symbolIndex = undefined
    this.importIndex = undefined
    this.fileIndex = undefined
  }

  // -------------------------------------------------------------------------
  // Index building
  // -------------------------------------------------------------------------

  private async buildIndices(projectRoot: string): Promise<void> {
    this.symbolIndex = new Map()
    this.importIndex = new Map()
    this.fileIndex = new Map()

    const gitignorePatterns = await loadGitignore(projectRoot)

    const walker = walkDir(projectRoot, {
      ignore: IGNORED_DIRS,
      gitignorePatterns,
    })

    for await (const entry of walker) {
      if (entry.isDir) continue

      const ext = extname(entry.path)
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue

      let content: string
      try {
        content = await readFile(entry.path, 'utf-8')
      } catch {
        continue // Unreadable file, skip
      }

      // Skip very large files (>500KB) to avoid perf issues
      if (content.length > 500_000) continue

      const { symbols, imports } = this.parseFile(entry.relativePath, content)

      // Count lines for fileIndex
      let lineCount = 1
      for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) lineCount++
      }

      // Store per-file data in fileIndex (for caching parseFile results + line counts)
      this.fileIndex.set(entry.relativePath, { lines: lineCount, symbols, imports })

      // Index symbols by name
      for (const sym of symbols) {
        const existing = this.symbolIndex.get(sym.name)
        if (existing) {
          existing.push(sym)
        } else {
          this.symbolIndex.set(sym.name, [sym])
        }

        // Also index child symbols (class methods, etc.)
        if (sym.children) {
          for (const child of sym.children) {
            const key = `${sym.name}.${child.name}`
            const childExisting = this.symbolIndex.get(key)
            if (childExisting) {
              childExisting.push(child)
            } else {
              this.symbolIndex.set(key, [child])
            }
          }
        }
      }

      // Index imports by relative file path
      if (imports.length > 0) {
        this.importIndex.set(entry.relativePath, imports)
      }
    }
  }
}
