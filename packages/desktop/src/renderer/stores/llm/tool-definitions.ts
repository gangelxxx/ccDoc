/**
 * Tool definitions array for the LLM chat engine.
 */

import type { ToolDefinition } from "./types.js";
import { isPlanModeTool, ORCHESTRATOR_TOOLS } from "../../llm-utils.js";

/**
 * Builds the core documentation tools (always available).
 */
function buildCoreTools(): ToolDefinition[] {
  return [
    {
      name: "get_tree",
      description: "Get documentation tree. Supports depth limit and subtree.",
      input_schema: {
        type: "object" as const,
        properties: {
          max_depth: { type: "number", description: "Max depth (0=root only). Omit for full tree." },
          parent_id: { type: "string", description: "Subtree root ID. Omit for full tree." },
        },
        required: [] as string[],
      },
    },
    {
      name: "get_section",
      description: "Get section content with offset/limit pagination and format selection.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
          offset: { type: "number", description: "Char offset to continue reading." },
          limit: { type: "number", description: "Max chars (cap 10000, default 6000)." },
          format: { type: "string", enum: ["markdown", "plain"], description: "'markdown' (default) or 'plain'." },
        },
        required: ["section_id"],
      },
    },
    {
      name: "search",
      description: "Full-text search. Returns id, title, type, snippet, score.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (1-50, default 20)." },
        },
        required: ["query"],
      },
    },
    {
      name: "create_section",
      description: "Create section. Always provide 'content' for file/idea/section/todo.",
      input_schema: {
        type: "object" as const,
        properties: {
          parent_id: { type: "string", description: "Parent ID. Omit for root (folder only)." },
          title: { type: "string", description: "Title" },
          type: { type: "string", enum: ["folder", "file", "section", "idea", "todo", "kanban", "drawing"], description: "Type" },
          content: { type: "string", description: "Markdown content." },
          icon: { type: "string", description: "One emoji icon." },
        },
        required: ["title", "type"],
      },
    },
    {
      name: "bulk_create_sections",
      description: "Create multiple sections. Use '$0','$1' as parent_id refs.",
      input_schema: {
        type: "object" as const,
        properties: {
          sections: {
            type: "array",
            description: "Sections to create",
            items: {
              type: "object",
              properties: {
                parent_id: { type: "string", description: "Parent ID or '$N' ref" },
                title: { type: "string", description: "Title" },
                type: { type: "string", enum: ["folder", "file", "section", "idea", "todo", "kanban", "drawing"], description: "Type" },
                content: { type: "string", description: "Markdown content" },
                icon: { type: "string", description: "One emoji" },
              },
              required: ["title", "type"],
            },
          },
        },
        required: ["sections"],
      },
    },
    {
      name: "update_section",
      description: "Update section title and/or content.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
          title: { type: "string", description: "New title (omit to keep)" },
          content: { type: "string", description: "New markdown content (omit to keep)" },
        },
        required: ["section_id"],
      },
    },
    {
      name: "move_section",
      description: "Move section to new parent and/or reorder.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
          new_parent_id: { type: "string", description: "New parent ID, null for root" },
          after_id: { type: "string", description: "Place after this sibling (null=first)" },
        },
        required: ["section_id"],
      },
    },
    {
      name: "delete_section",
      description: "Soft-delete section and children.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
        },
        required: ["section_id"],
      },
    },
    {
      name: "duplicate_section",
      description: "Deep copy section with children.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
        },
        required: ["section_id"],
      },
    },
    {
      name: "restore_section",
      description: "Restore soft-deleted section and children.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
        },
        required: ["section_id"],
      },
    },
    {
      name: "update_icon",
      description: "Set/remove emoji icon for section.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID" },
          icon: { type: "string", description: "One emoji or null to remove." },
        },
        required: ["section_id", "icon"],
      },
    },
    {
      name: "get_file_with_sections",
      description: "Get file with sub-sections. Supports depth, metadata-only, format.",
      input_schema: {
        type: "object" as const,
        properties: {
          file_id: { type: "string", description: "File section UUID" },
          max_depth: { type: "number", description: "Sub-section depth limit." },
          include_content: { type: "boolean", description: "false = structure only." },
          format: { type: "string", enum: ["markdown", "plain"], description: "'markdown' or 'plain'." },
        },
        required: ["file_id"],
      },
    },
    {
      name: "get_sections_batch",
      description: "Get up to 20 sections at once. Use get_section for full content.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_ids: { type: "array", items: { type: "string" }, description: "Section UUIDs (max 20)" },
          format: { type: "string", enum: ["markdown", "plain"], description: "'markdown' or 'plain'." },
        },
        required: ["section_ids"],
      },
    },
    {
      name: "commit_version",
      description: "Save version snapshot (git commit).",
      input_schema: {
        type: "object" as const,
        properties: {
          message: { type: "string", description: "Commit message" },
        },
        required: ["message"],
      },
    },
    {
      name: "get_history",
      description: "Get version history (commits list).",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "restore_version",
      description: "Roll back to a specific version.",
      input_schema: {
        type: "object" as const,
        properties: {
          commit_id: { type: "string", description: "Commit OID from get_history" },
        },
        required: ["commit_id"],
      },
    },
    {
      name: "create_backup",
      description: "Create database backup.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "list_backups",
      description: "List database backups with dates and sizes.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
  ];
}

/**
 * Builds source code tools (only when includeSourceCode is true).
 */
function buildSourceCodeTools(): ToolDefinition[] {
  return [
    {
      name: "get_project_tree",
      description: "Source code file tree with glob filtering and depth limits.",
      input_schema: {
        type: "object" as const,
        properties: {
          glob: { type: "string", description: "Glob filter (e.g. 'src/**/*.ts')." },
          max_depth: { type: "number", description: "Max dir depth (0=root only)." },
        },
        required: [] as string[],
      },
    },
    {
      name: "get_file_outlines",
      description: "Compact outlines (signatures+line numbers) for up to 20 source files.",
      input_schema: {
        type: "object" as const,
        properties: {
          paths: { type: "array", items: { type: "string" }, description: "Relative file paths" },
        },
        required: ["paths"],
      },
    },
    {
      name: "read_project_file",
      description: "Read source file. Use startLine/endLine for targeted reading.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Relative file path" },
          startLine: { type: "number", description: "Start line (1-based)." },
          endLine: { type: "number", description: "End line (inclusive). Default: startLine+200." },
        },
        required: ["path"],
      },
    },
    {
      name: "search_project_files",
      description: "Grep-like search across source files.",
      input_schema: {
        type: "object" as const,
        properties: {
          pattern: { type: "string", description: "Search pattern." },
          is_regex: { type: "boolean", description: "Regex mode. Default: false." },
          case_sensitive: { type: "boolean", description: "Default: false." },
          include: { type: "string", description: "File glob filter." },
          context_lines: { type: "number", description: "Context lines (0-10, default 2)." },
          output_mode: { type: "string", enum: ["content", "files", "count"], description: "Output mode. Default: 'content'." },
          max_results: { type: "number", description: "Max matches (1-200, default 50)." },
        },
        required: ["pattern"],
      },
    },
    {
      name: "find_symbols",
      description: "Search symbol index. Returns 'name (kind) — file:line'.",
      input_schema: {
        type: "object" as const,
        properties: {
          name_pattern: { type: "string", description: "Name pattern (substring or /regex/)." },
          kind: { type: "string", enum: ["function", "class", "interface", "type", "variable", "method", "enum", "struct", "trait", "impl"], description: "Kind filter." },
          file_glob: { type: "string", description: "File glob filter." },
          max_results: { type: "number", description: "Max results (default 50)." },
        },
        required: [] as string[],
      },
    },
  ];
}

/**
 * Builds web search tools (only when web search is configured).
 */
function buildWebSearchTools(): ToolDefinition[] {
  return [
    {
      name: "web_search",
      description: "Search the internet. Use for external APIs, libraries, current events.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (English for best results)." },
          max_results: { type: "number", description: "Results count (1-10, default 5)." },
        },
        required: ["query"],
      },
    },
  ];
}

/**
 * Builds sub-agent delegation tools.
 */
function buildSubAgentTools(): ToolDefinition[] {
  const subAgentInputSchema = {
    type: "object" as const,
    properties: {
      task: { type: "string", description: "Clear description of what to do. Be specific." },
      context: { type: "string", description: "Optional: relevant section IDs, search terms, constraints." },
    },
    required: ["task"],
  };

  return [
    {
      name: "delegate_research",
      description: "Delegate research to sub-agent (reads docs, searches, explores code).",
      input_schema: subAgentInputSchema,
    },
    {
      name: "delegate_writing",
      description: "Delegate writing to sub-agent (reads+writes sections).",
      input_schema: subAgentInputSchema,
    },
    {
      name: "delegate_review",
      description: "Delegate review to sub-agent (quality, completeness analysis).",
      input_schema: subAgentInputSchema,
    },
    {
      name: "delegate_planning",
      description: "Delegate planning to sub-agent (structure proposals).",
      input_schema: subAgentInputSchema,
    },
  ];
}

/**
 * Builds the ask_user tool (always available for the main agent).
 */
function buildAskUserTool(): ToolDefinition {
  return {
    name: "ask_user",
    description: "Ask the user a clarifying question and wait for their response. ALWAYS provide options array with 2-5 suggested answers — the user can pick one or type a custom answer.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user. Be specific and concise.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "REQUIRED: 2-5 short suggested answers. User sees these as clickable choices. Keep each option under 60 chars.",
        },
      },
      required: ["question", "options"],
    },
  };
}

/**
 * Assembles the full tool set based on configuration flags.
 */
export function buildTools(params: {
  includeSourceCode: boolean;
  useSubAgents: boolean;
  planMode: boolean;
  webSearchEnabled?: boolean;
}): ToolDefinition[] {
  const { includeSourceCode, useSubAgents, planMode, webSearchEnabled } = params;

  const tools: ToolDefinition[] = [
    ...buildCoreTools(),
    buildAskUserTool(),
    ...(includeSourceCode ? buildSourceCodeTools() : []),
  ];

  if (webSearchEnabled) {
    tools.push(...buildWebSearchTools());
  }

  if (useSubAgents) {
    tools.push(...buildSubAgentTools());
  }

  if (planMode) return tools.filter(t => isPlanModeTool(t.name));

  // When sub-agents are enabled, the orchestrator should not get source code tools
  // (they must go through delegate_research). This saves ~2K chars of tool definitions.
  if (useSubAgents) return tools.filter(t => ORCHESTRATOR_TOOLS.has(t.name));

  return tools;
}

/**
 * Human-readable descriptions for tool progress display in UI.
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_tree: "Читаю структуру документации",
  get_section: "Читаю содержимое секции",
  get_file_with_sections: "Читаю документ с подсекциями",
  get_sections_batch: "Читаю несколько секций",
  search: "Ищу по документации",
  create_section: "Создаю секцию",
  bulk_create_sections: "Создаю секции",
  update_section: "Обновляю секцию",
  delete_section: "Удаляю секцию",
  move_section: "Перемещаю секцию",
  duplicate_section: "Дублирую секцию",
  restore_section: "Восстанавливаю секцию",
  update_icon: "Меняю иконку",
  commit_version: "Сохраняю версию",
  get_history: "Смотрю историю версий",
  restore_version: "Откатываю к версии",
  create_backup: "Создаю бэкап",
  list_backups: "Проверяю бэкапы",
  get_section_at_version: "Читаю версию секции",
  get_project_tree: "Просматриваю файлы проекта",
  get_file_outlines: "Читаю структуру файлов",
  read_project_file: "Читаю исходный код",
  search_project_files: "Ищу в коде",
  find_symbols: "Ищу символы в коде",
  delegate_research: "Делегирую исследование субагенту",
  delegate_writing: "Делегирую написание субагенту",
  delegate_review: "Делегирую ревью субагенту",
  delegate_planning: "Делегирую планирование субагенту",
  web_search: "Ищу в интернете",
  ask_user: "Задаю уточняющий вопрос",
};
