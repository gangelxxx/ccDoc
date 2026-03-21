import { LogLevel } from './types'

export interface Token {
  type: string
  value: string
  line: number
}

/** Tokenize input string */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let line = 1
  for (const ch of input) {
    if (ch === '\n') line++
    tokens.push({ type: 'char', value: ch, line })
  }
  return tokens
}

/** Parse tokens into AST */
export function parse(tokens: Token[]): Record<string, unknown> {
  return { type: 'program', tokens: tokens.length }
}

function internalValidate(tokens: Token[]): boolean {
  return tokens.length > 0
}
