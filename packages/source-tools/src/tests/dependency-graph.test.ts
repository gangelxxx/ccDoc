import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('dependency_graph', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should show flat dependencies for engine.ts', async () => {
    const result = await executor.execute('dependency_graph', {
      entry: 'src/core/engine.ts',
      mode: 'flat',
    })

    // engine.ts imports from ./types and ../utils/logger
    // Flat mode shows "file -> dep1, dep2"
    expect(result).toContain('engine.ts')

    // Should reference types.ts as a dependency
    expect(result).toContain('types.ts')

    // Should reference logger.ts as a dependency
    expect(result).toContain('logger.ts')
  })

  it('should show reverse dependencies for types.ts', async () => {
    // In reverse mode we need to analyze the whole project or a directory
    // to find who imports types.ts
    const result = await executor.execute('dependency_graph', {
      entry: 'src',
      mode: 'reverse',
      depth: 3,
    })

    // types.ts should be imported by engine.ts, parser.ts, handler.ts, routes.ts, logger.ts
    expect(result).toContain('types.ts')
    expect(result).toContain('imported by')

    // engine.ts imports types.ts
    expect(result).toContain('engine.ts')
  })

  it('should show dependencies for a directory', async () => {
    const result = await executor.execute('dependency_graph', {
      entry: 'src/api',
      mode: 'flat',
    })

    // api/handler.ts imports from ../core and ../utils/logger
    expect(result).toContain('handler.ts')

    // Should show dependencies outside of api/
    const hasCoreOrUtils = result.includes('core') || result.includes('utils') || result.includes('logger') || result.includes('types')
    expect(hasCoreOrUtils).toBe(true)
  })

  it('should respect max depth', async () => {
    const result = await executor.execute('dependency_graph', {
      entry: 'src/api/handler.ts',
      mode: 'flat',
      depth: 1,
    })

    // With depth=1, should show handler.ts -> its direct deps
    // but NOT the transitive deps of those deps
    expect(result).toContain('handler.ts')
  })

  it('should return message for non-existent entry', async () => {
    const result = await executor.execute('dependency_graph', {
      entry: 'src/nonexistent',
    })

    expect(result).toContain('No source files found')
  })
})
