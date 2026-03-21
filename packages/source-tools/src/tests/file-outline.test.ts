import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('file_outline', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should show outline of engine.ts with IMPORTS and EXPORTS', async () => {
    const result = await executor.execute('file_outline', {
      paths: ['src/core/engine.ts'],
    })

    // Should have file header with line count
    expect(result).toContain('src/core/engine.ts')
    expect(result).toContain('lines')

    // Should have IMPORTS section
    expect(result).toContain('IMPORTS:')
    expect(result).toContain('./types')
    expect(result).toContain('../utils/logger')

    // Should have EXPORTS section with class and function
    expect(result).toContain('EXPORTS:')
    expect(result).toContain('Engine')
    expect(result).toContain('createEngine')

    // Class methods should be listed as children
    expect(result).toContain('start')
    expect(result).toContain('stop')
    expect(result).toContain('getState')
    expect(result).toContain('process')
  })

  it('should show INTERNAL section when include_private=true', async () => {
    const result = await executor.execute('file_outline', {
      paths: ['src/core/engine.ts'],
      include_private: true,
    })

    // Should have INTERNAL section
    expect(result).toContain('INTERNAL:')
    // _internalHelper is a non-exported variable
    expect(result).toContain('_internalHelper')
  })

  it('should show outlines for multiple files', async () => {
    const result = await executor.execute('file_outline', {
      paths: ['src/core/engine.ts', 'src/utils/helpers.ts'],
    })

    // Both files should be present
    expect(result).toContain('src/core/engine.ts')
    expect(result).toContain('src/utils/helpers.ts')

    // Exports from both files
    expect(result).toContain('Engine')
    expect(result).toContain('formatBytes')
    expect(result).toContain('sleep')
    expect(result).toContain('clamp')
  })

  it('should show JSDoc comments when include_jsdoc=true', async () => {
    const result = await executor.execute('file_outline', {
      paths: ['src/core/engine.ts'],
      include_jsdoc: true,
    })

    // JSDoc for the Engine class and createEngine function
    expect(result).toContain('Main processing engine')
    expect(result).toContain('Create an engine with defaults')
  })

  it('should handle non-existent files gracefully', async () => {
    const result = await executor.execute('file_outline', {
      paths: ['src/nonexistent.ts'],
    })

    expect(result).toContain('not found')
  })
})
