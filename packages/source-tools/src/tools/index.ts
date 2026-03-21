import type { Tool, ToolContext } from './types.js'
import { SymbolParser } from '../parser/index.js'
import { truncateOutput } from '../utils/format.js'

// Tool factories
import { createProjectTreeTool } from './project-tree.js'
import { createFileOutlineTool } from './file-outline.js'
import { createModuleSummaryTool } from './module-summary.js'
import { createReadRangeTool } from './read-range.js'
import { createReadSymbolTool } from './read-symbol.js'
import { createReadBatchTool } from './read-batch.js'
import { createFindSymbolTool } from './find-symbol.js'
import { createFindReferencesTool } from './find-references.js'
import { createGrepTool } from './grep.js'
import { createDependencyGraphTool } from './dependency-graph.js'

/**
 * Central registry and executor for all source-tools.
 *
 * Owns the shared SymbolParser instance and ToolContext.
 * All tool results are automatically truncated to `maxOutputChars`.
 */
export class ToolExecutor {
  private tools: Map<string, Tool>
  private ctx: ToolContext

  constructor(projectRoot: string, opts?: { maxOutputChars?: number }) {
    this.ctx = {
      projectRoot,
      maxOutputChars: opts?.maxOutputChars ?? 4000,
    }

    const parser = new SymbolParser()

    this.tools = new Map()

    const allTools: Tool[] = [
      createProjectTreeTool(),
      createFileOutlineTool(parser),
      createModuleSummaryTool(parser),
      createReadRangeTool(),
      createReadSymbolTool(parser),
      createReadBatchTool(parser),
      createFindSymbolTool(parser),
      createFindReferencesTool(parser),
      createGrepTool(),
      createDependencyGraphTool(parser),
    ]

    for (const tool of allTools) {
      this.tools.set(tool.name, tool)
    }
  }

  /**
   * Execute a tool by name with the given parameters.
   * Returns the result string, or an error message if the tool is unknown or throws.
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(toolName)
    if (!tool) return `Error: unknown tool "${toolName}"`

    try {
      const result = await tool.execute(params, this.ctx)
      return truncateOutput(result, this.ctx.maxOutputChars)
    } catch (err) {
      return `Error: ${(err as Error).message}`
    }
  }

  /**
   * Get MCP-compatible tool definitions for all registered tools.
   */
  getToolDefinitions(): Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
  }
}

// Re-export types for consumers
export type { Tool, ToolContext, Symbol, SymbolKind, Import } from './types.js'
