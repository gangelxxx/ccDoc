import Parser from 'tree-sitter'

/**
 * Maps file extensions to tree-sitter grammar names.
 * Note: .ts and .tsx use different grammars from tree-sitter-typescript.
 */
const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
}

/** Cached parser instances per language */
const parsers = new Map<string, Parser>()

/** Get the tree-sitter language name for a file extension, or undefined if unsupported */
export function getLanguageForExt(ext: string): string | undefined {
  return LANG_MAP[ext]
}

/**
 * Load a tree-sitter grammar by language name.
 * Uses dynamic require() because tree-sitter grammars are native modules.
 */
function loadLanguage(lang: string): Parser.Language | undefined {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    if (lang === 'typescript') return require('tree-sitter-typescript').typescript
    if (lang === 'tsx') return require('tree-sitter-typescript').tsx
    if (lang === 'javascript') return require('tree-sitter-javascript')
    if (lang === 'python') return require('tree-sitter-python')
    if (lang === 'rust') return require('tree-sitter-rust')
    if (lang === 'go') return require('tree-sitter-go')
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Get or create a Parser for the given language.
 * Returns undefined if the grammar could not be loaded.
 */
export function getParser(language: string): Parser | undefined {
  const cached = parsers.get(language)
  if (cached) return cached

  const lang = loadLanguage(language)
  if (!lang) return undefined

  const parser = new Parser()
  parser.setLanguage(lang)
  parsers.set(language, parser)
  return parser
}

/**
 * Parse source code for a given file path.
 * Automatically selects the grammar based on file extension.
 * Returns undefined if the language is unsupported or grammar failed to load.
 */
export function parseCode(content: string, filePath: string): Parser.Tree | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  const lang = getLanguageForExt(ext)
  if (!lang) return undefined

  const parser = getParser(lang)
  if (!parser) return undefined

  return parser.parse(content)
}
