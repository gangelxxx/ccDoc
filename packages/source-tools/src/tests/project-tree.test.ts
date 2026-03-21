import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { ToolExecutor } from '../tools/index'

const fixturesPath = resolve(__dirname, 'fixtures')

describe('project_tree', () => {
  let executor: ToolExecutor

  beforeAll(() => {
    executor = new ToolExecutor(fixturesPath, { maxOutputChars: 10000 })
  })

  it('should show the full directory tree', async () => {
    const result = await executor.execute('project_tree', {})

    // Should contain top-level directories
    expect(result).toContain('src/')

    // Should contain nested directories
    expect(result).toContain('core/')
    expect(result).toContain('utils/')
    expect(result).toContain('api/')

    // Should contain files
    expect(result).toContain('engine.ts')
    expect(result).toContain('types.ts')
    expect(result).toContain('logger.ts')
    expect(result).toContain('helpers.ts')
    expect(result).toContain('handler.ts')
    expect(result).toContain('routes.ts')
    expect(result).toContain('package.json')
  })

  it('should filter by glob pattern — only .ts files', async () => {
    const result = await executor.execute('project_tree', {
      glob: 'src/**/*.ts',
    })

    // Should contain .ts files
    expect(result).toContain('engine.ts')
    expect(result).toContain('types.ts')
    expect(result).toContain('logger.ts')

    // Should NOT contain non-ts files
    expect(result).not.toContain('package.json')
    expect(result).not.toContain('.gitignore')
  })

  it('should respect max_depth=1 — only top-level entries', async () => {
    const result = await executor.execute('project_tree', {
      max_depth: 1,
    })

    // Should contain top-level directory
    expect(result).toContain('src/')

    // At depth=1 we can go into src/ and see core/, utils/, api/ and index.ts
    // but NOT the files within core/, utils/, api/
    // depth 0 = root, depth 1 = src contents
    // Since max_depth=1, children of src/ (depth=1) are shown,
    // but their children (depth=2) would be empty
    expect(result).toContain('core/')
    expect(result).toContain('utils/')
    expect(result).toContain('api/')

    // Files directly in src/ should appear
    expect(result).toContain('index.ts')
  })

  it('should return empty message for non-matching glob', async () => {
    const result = await executor.execute('project_tree', {
      glob: '**/*.py',
    })

    expect(result).toContain('No files matching')
  })
})
