import { readFile } from 'fs/promises'
import { join } from 'path'

/** Directories that should always be skipped during traversal */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.cache',
  '.venv',
  'venv',
  'vendor',
  '.idea',
  '.vscode',
  'target',
  '.turbo',
  '.output',
  '.svelte-kit',
  '.parcel-cache',
  'out',
])

/** Check if a directory/file name should be ignored */
export function shouldIgnore(name: string): boolean {
  return IGNORED_DIRS.has(name)
}

/**
 * Load .gitignore from project root and return parsed patterns.
 * Returns empty array if .gitignore doesn't exist.
 */
export async function loadGitignore(projectRoot: string): Promise<string[]> {
  try {
    const content = await readFile(join(projectRoot, '.gitignore'), 'utf-8')
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  } catch {
    return []
  }
}
