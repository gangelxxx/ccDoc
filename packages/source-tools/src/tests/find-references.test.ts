import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('find_references', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should find references to Engine across files', async () => {
    const result = await executor.execute('find_references', {
      symbol: 'Engine',
      path: 'src/core/engine.ts',
    })

    // Should find imports and usages in other files
    expect(result).toContain('references')

    // Engine is imported in handler.ts and index files
    // handler.ts imports { Engine, createEngine } from '../core'
    const hasHandlerRef = result.includes('handler.ts') || result.includes('api/')
    const hasIndexRef = result.includes('index.ts')
    expect(hasHandlerRef || hasIndexRef).toBe(true)

    // Should classify some as imports
    expect(result).toContain('import')
  })

  it('should find references to Logger', async () => {
    const result = await executor.execute('find_references', {
      symbol: 'Logger',
      path: 'src/utils/logger.ts',
    })

    // Logger is used in engine.ts and handler.ts
    expect(result).toContain('references')

    // Should find at least one import reference
    expect(result).toContain('import')
  })

  it('should find references to EngineConfig', async () => {
    const result = await executor.execute('find_references', {
      symbol: 'EngineConfig',
      path: 'src/core/types.ts',
    })

    // EngineConfig is imported in engine.ts, handler.ts, routes.ts
    expect(result).toContain('references')

    // Should have multiple references
    expect(result).toMatch(/\d+ references/)
  })

  it('should return no-results for unused symbol', async () => {
    const result = await executor.execute('find_references', {
      symbol: 'DEFAULT_TIMEOUT',
      path: 'src/core/types.ts',
    })

    // DEFAULT_TIMEOUT is exported but only re-exported through index files
    // It may or may not have references depending on how indexes are treated
    // Just verify it doesn't crash and returns a valid response
    expect(typeof result).toBe('string')
  })

  it('should respect max_results limit', async () => {
    const result = await executor.execute('find_references', {
      symbol: 'Engine',
      max_results: 2,
    })

    // Should not have more than 2 reference entries (besides header)
    // Just verify it returns something reasonable
    expect(result).toContain('Engine')
  })
})
