import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('read_symbol', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should read a function by name', async () => {
    const result = await executor.execute('read_symbol', {
      symbol: 'createEngine',
      path: 'src/core/engine.ts',
    })

    // Should contain the function source
    expect(result).toContain('createEngine')
    expect(result).toContain('EngineConfig')

    // Should have a file path header comment
    expect(result).toMatch(/\/\/.*engine\.ts/)

    // Should have numbered lines
    expect(result).toMatch(/\d+\|/)
  })

  it('should read a class method with dotted notation', async () => {
    const result = await executor.execute('read_symbol', {
      symbol: 'Engine.start',
      path: 'src/core/engine.ts',
    })

    // Should contain the method body
    expect(result).toContain('start')

    // Should reference the engine.ts file
    expect(result).toMatch(/engine\.ts/)

    // Should have numbered lines
    expect(result).toMatch(/\d+\|/)
  })

  it('should read a symbol from a specific file', async () => {
    const result = await executor.execute('read_symbol', {
      symbol: 'tokenize',
      path: 'src/core/parser.ts',
    })

    // Should contain the function source
    expect(result).toContain('tokenize')
    expect(result).toContain('Token')

    // Should reference parser.ts
    expect(result).toMatch(/parser\.ts/)
  })

  it('should truncate large symbols with max_lines', async () => {
    // Engine class is relatively long, using a very small max_lines
    const result = await executor.execute('read_symbol', {
      symbol: 'Engine',
      path: 'src/core/engine.ts',
      max_lines: 5,
    })

    // Should still be present but possibly truncated or showing outline
    expect(result).toContain('Engine')

    // Should show some indication of truncation or outline
    const isTruncated = result.includes('truncated') || result.includes('outline') || result.includes('lines')
    expect(isTruncated).toBe(true)
  })

  it('should return error for non-existent symbol', async () => {
    const result = await executor.execute('read_symbol', {
      symbol: 'NonExistentSymbolXYZ',
    })

    expect(result).toContain('not found')
  })
})
