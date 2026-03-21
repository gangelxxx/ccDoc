import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('find_symbol', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should find symbols by name substring', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'Engine',
    })

    // Should find the Engine class
    expect(result).toContain('Engine')
    expect(result).toContain('class')

    // Should find EngineConfig interface
    expect(result).toContain('EngineConfig')

    // Should find EngineState type
    expect(result).toContain('EngineState')

    // Should find createEngine function
    expect(result).toContain('createEngine')
  })

  it('should filter by kind — only functions', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'create',
      kind: 'function',
    })

    // Should find createEngine, createLogger, createRoutes
    expect(result).toContain('createEngine')
    expect(result).toContain('function')

    // Should NOT include classes, interfaces, types
    // (EngineConfig would appear for name match but kind filter should exclude it)
    expect(result).not.toContain('(class)')
    expect(result).not.toContain('(interface)')
  })

  it('should filter exported_only — no internal symbols', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'internal',
      exported_only: false,
    })

    // Without exported_only, _internalHelper or internalValidate should appear
    const hasInternal =
      result.includes('_internalHelper') || result.includes('internalValidate')
    expect(hasInternal).toBe(true)

    // With exported_only
    const resultExported = await executor.execute('find_symbol', {
      name: 'internal',
      exported_only: true,
    })

    // Should not find any internal symbols
    expect(resultExported).not.toContain('_internalHelper')
    expect(resultExported).not.toContain('internalValidate')
  })

  it('should return no-results message for non-existent symbol', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'NonExistentSymbolXYZ',
    })

    expect(result).toContain('No symbols matching')
  })

  it('should find class methods', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'start',
    })

    // Engine.start method should appear
    expect(result).toContain('start')
    expect(result).toContain('method')
  })

  it('should support | OR syntax to find multiple names at once', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'createEngine|Logger|handleRequest',
    })

    // Should find all three in a single call
    expect(result).toContain('createEngine')
    expect(result).toContain('Logger')
    expect(result).toContain('handleRequest')
  })

  it('should use em dash in output format', async () => {
    const result = await executor.execute('find_symbol', {
      name: 'Engine',
      kind: 'class',
    })

    // Format should be: Engine (class) — path:line
    expect(result).toContain('\u2014')
    expect(result).not.toContain(' -- ')
  })
})
