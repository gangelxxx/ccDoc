import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('read_range', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should read a file with numbered lines', async () => {
    const result = await executor.execute('read_range', {
      path: 'src/core/types.ts',
    })

    // Should contain line numbers and content
    expect(result).toContain('1|')
    expect(result).toContain('EngineConfig')
    expect(result).toContain('EngineState')
    expect(result).toContain('LogLevel')
    expect(result).toContain('DEFAULT_TIMEOUT')
  })

  it('should read a specific range of lines', async () => {
    const result = await executor.execute('read_range', {
      path: 'src/core/types.ts',
      start_line: 2,
      end_line: 7,
    })

    // Should contain lines from the range
    expect(result).toContain('EngineConfig')

    // Should have line numbers starting from 2
    expect(result).toContain('2|')

    // Line 1 (the JSDoc comment) should not be in output
    // since we start from line 2
    expect(result).not.toMatch(/\b1\|.*Engine configuration/)
  })

  it('should truncate with skip marker when max_lines is exceeded', async () => {
    // engine.ts has ~55 lines, setting max_lines=10 should trigger truncation
    const result = await executor.execute('read_range', {
      path: 'src/core/engine.ts',
      start_line: 1,
      end_line: 55,
      max_lines: 10,
    })

    // Should contain skip marker
    expect(result).toContain('skipped')
    expect(result).toContain('lines')

    // Should still have beginning and end of the file
    expect(result).toContain('1|')
  })

  it('should handle start beyond file end gracefully', async () => {
    const result = await executor.execute('read_range', {
      path: 'src/core/types.ts',
      start_line: 9999,
    })

    expect(result).toContain('beyond end of file')
  })

  it('should handle non-existent file', async () => {
    const result = await executor.execute('read_range', {
      path: 'src/nonexistent.ts',
    })

    expect(result).toContain('Error')
  })
})
