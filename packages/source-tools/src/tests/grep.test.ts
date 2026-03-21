import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve, join } from 'path'
import { writeFile, unlink } from 'fs/promises'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('grep', () => {
  let executor: ToolExecutor
  const binaryFilePath = join(fixturesPath, 'binary.dat')

  beforeAll(async () => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })

    // Create a binary file with null bytes for testing binary skip
    const buf = Buffer.alloc(64, 0)
    buf.write('Engine', 0) // Put the search term in the binary
    await writeFile(binaryFilePath, buf)
  })

  afterAll(async () => {
    try {
      await unlink(binaryFilePath)
    } catch {
      // ignore if already cleaned up
    }
  })

  it('should find pattern in content mode with context lines', async () => {
    const result = await executor.execute('grep', {
      pattern: 'EngineConfig',
      mode: 'content',
      context_lines: 1,
    })

    // Should contain file paths and matching lines
    expect(result).toContain('EngineConfig')

    // Content mode shows file paths as headers
    expect(result).toContain('src/core/types.ts')

    // Should have line numbers with : for matches
    expect(result).toMatch(/\d+:/)
  })

  it('should return file list in files mode', async () => {
    const result = await executor.execute('grep', {
      pattern: 'EngineConfig',
      mode: 'files',
    })

    // Should list files with match counts
    expect(result).toContain('src/core/types.ts')
    expect(result).toContain('matches')

    // EngineConfig is used in multiple files
    expect(result).toContain('src/core/engine.ts')
  })

  it('should return summary in count mode', async () => {
    const result = await executor.execute('grep', {
      pattern: 'EngineConfig',
      mode: 'count',
    })

    // Should have "X matches in Y files" format
    expect(result).toMatch(/\d+ matches in \d+ files/)
  })

  it('should respect include filter', async () => {
    const result = await executor.execute('grep', {
      pattern: 'export',
      mode: 'files',
      include: 'src/utils/**',
    })

    // Should only find files under src/utils/
    expect(result).toContain('src/utils/')

    // Should NOT include files from other directories
    expect(result).not.toContain('src/core/')
    expect(result).not.toContain('src/api/')
  })

  it('should skip binary files', async () => {
    const result = await executor.execute('grep', {
      pattern: 'Engine',
      mode: 'files',
    })

    // Should NOT include binary.dat even though it contains "Engine"
    expect(result).not.toContain('binary.dat')
  })

  it('should support regex patterns', async () => {
    const result = await executor.execute('grep', {
      pattern: 'export (class|function)',
      is_regex: true,
      mode: 'files',
    })

    // Should find files with export class or export function
    expect(result).toContain('.ts')
    expect(result).toContain('matches')
  })

  it('should return no-results message for non-matching pattern', async () => {
    const result = await executor.execute('grep', {
      pattern: 'ZZZZNONEXISTENT12345',
    })

    expect(result).toContain('No matches found')
  })

  it('should support | as OR in non-regex mode', async () => {
    const result = await executor.execute('grep', {
      pattern: 'createEngine|createLogger|createRoutes',
      mode: 'files',
    })

    // Should find all three in a single call
    expect(result).toContain('engine.ts')
    expect(result).toContain('logger.ts')
    expect(result).toContain('routes.ts')
  })
})
