import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('read_batch', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 20000 })
  })

  it('should read multiple ranges from different files', async () => {
    const result = await executor.execute('read_batch', {
      ranges: [
        { path: 'src/core/types.ts', start_line: 1, end_line: 10 },
        { path: 'src/utils/helpers.ts', start_line: 1, end_line: 10 },
      ],
    })

    // Should contain headers for both files
    expect(result).toContain('src/core/types.ts')
    expect(result).toContain('src/utils/helpers.ts')

    // Should contain content from both files
    expect(result).toContain('EngineConfig')
    expect(result).toContain('formatBytes')
  })

  it('should read by symbol name', async () => {
    const result = await executor.execute('read_batch', {
      ranges: [
        { path: 'src/core/engine.ts', symbol: 'createEngine' },
      ],
    })

    // Should contain the function source
    expect(result).toContain('src/core/engine.ts')
    expect(result).toContain('createEngine')
  })

  it('should handle missing symbol gracefully', async () => {
    const result = await executor.execute('read_batch', {
      ranges: [
        { path: 'src/core/types.ts', symbol: 'NonExistent' },
      ],
    })

    expect(result).toContain('not found')
  })

  it('should read whole file with default range', async () => {
    const result = await executor.execute('read_batch', {
      ranges: [
        { path: 'src/utils/helpers.ts' },
      ],
    })

    // Should contain file header and content
    expect(result).toContain('src/utils/helpers.ts')
    expect(result).toContain('formatBytes')
    expect(result).toContain('sleep')
    expect(result).toContain('clamp')
  })

  it('should apply compression when total exceeds budget', async () => {
    // Create many range requests to trigger compression
    // Each file is ~15-55 lines; requesting many with high max_lines
    const ranges = [
      { path: 'src/core/engine.ts', max_lines: 500 },
      { path: 'src/core/types.ts', max_lines: 500 },
      { path: 'src/core/parser.ts', max_lines: 500 },
      { path: 'src/utils/logger.ts', max_lines: 500 },
      { path: 'src/utils/helpers.ts', max_lines: 500 },
      { path: 'src/api/handler.ts', max_lines: 500 },
      { path: 'src/api/routes.ts', max_lines: 500 },
      { path: 'src/core/index.ts', max_lines: 500 },
      { path: 'src/utils/index.ts', max_lines: 500 },
      { path: 'src/index.ts', max_lines: 500 },
    ]

    const result = await executor.execute('read_batch', { ranges })

    // Should still contain all file headers
    expect(result).toContain('src/core/engine.ts')
    expect(result).toContain('src/utils/helpers.ts')
    expect(result).toContain('src/api/handler.ts')

    // All files should be present even if compressed
    for (const range of ranges) {
      expect(result).toContain(range.path)
    }
  })

  it('should return error for empty ranges array', async () => {
    const result = await executor.execute('read_batch', {
      ranges: [],
    })

    expect(result).toContain('Error')
  })
})
