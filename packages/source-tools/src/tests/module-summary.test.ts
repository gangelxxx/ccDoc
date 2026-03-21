import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('module_summary', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should summarize the core/ module', async () => {
    const result = await executor.execute('module_summary', {
      path: 'src/core',
    })

    // Should have header with file count and line count
    expect(result).toContain('src/core')
    expect(result).toMatch(/\d+ files/)
    expect(result).toMatch(/\d+ lines/)

    // Should have PUBLIC API section (detected via barrel index.ts)
    expect(result).toContain('PUBLIC API:')

    // Public API should contain re-exported symbols
    expect(result).toContain('Engine')
    expect(result).toContain('createEngine')
    expect(result).toContain('tokenize')
    expect(result).toContain('parse')

    // Should have FILES section
    expect(result).toContain('FILES:')
    expect(result).toContain('engine.ts')
    expect(result).toContain('parser.ts')
    expect(result).toContain('types.ts')
    expect(result).toContain('index.ts')

    // Barrel file should be annotated
    expect(result).toContain('barrel')
  })

  it('should show DEPENDS ON section for modules with external deps', async () => {
    const result = await executor.execute('module_summary', {
      path: 'src/core',
    })

    // core/ depends on utils/logger (engine.ts imports from ../utils/logger)
    expect(result).toContain('DEPENDS ON:')
    expect(result).toContain('utils')
  })

  it('should show IMPORTED BY section', async () => {
    const result = await executor.execute('module_summary', {
      path: 'src/core',
    })

    // core/ is imported by api/handler.ts, api/routes.ts, src/index.ts
    expect(result).toContain('IMPORTED BY:')
  })

  it('should summarize the utils/ module', async () => {
    const result = await executor.execute('module_summary', {
      path: 'src/utils',
    })

    // Should have proper header
    expect(result).toContain('src/utils')

    // Should have public API from barrel
    expect(result).toContain('PUBLIC API:')
    expect(result).toContain('Logger')
    expect(result).toContain('formatBytes')
    expect(result).toContain('sleep')
    expect(result).toContain('clamp')
  })

  it('should return error for non-existent directory', async () => {
    const result = await executor.execute('module_summary', {
      path: 'src/nonexistent',
    })

    expect(result).toContain('not found')
  })

  it('should return error when path is a file, not a directory', async () => {
    const result = await executor.execute('module_summary', {
      path: 'src/core/engine.ts',
    })

    expect(result).toContain('not a directory')
  })
})
