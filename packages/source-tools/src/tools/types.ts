/** Shared types for source-tools package */

export interface ToolContext {
  projectRoot: string
  maxOutputChars: number // default 4000
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

export interface Symbol {
  name: string
  kind: SymbolKind
  exported: boolean
  startLine: number
  endLine: number
  signature: string
  filePath: string
  parentName?: string
  jsdoc?: string
  children?: Symbol[]
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'method'
  | 'enum'
  | 'property'

export interface Import {
  names: string[]
  source: string
  isExternal: boolean
  line: number
}
