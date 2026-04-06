/**
 * Tool definitions array for the LLM chat engine.
 */

import type { ToolDefinition, CustomAgent } from "./types.js";
import { isPlanModeTool } from "../../llm-utils.js";

/**
 * Builds the core documentation tools (always available).
 */
function buildCoreTools(): ToolDefinition[] {
  return [
    {
      name: "gt",
      description: "Navigate documentation tree. Returns node metadata (title, type, content_length, summary, children_count) without content. Use read() for content.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Node ID (slug or UUID). Omit for root + tree stats." },
          depth: { type: "number", description: "0=node info only, 1=direct children (default), 2+=deeper." },
          offset: { type: "number", description: "Skip N children (for pagination)." },
          limit: { type: "number", description: "Max children to return (default 50, max 200)." },
          sort: { type: "string", enum: ["default", "updated", "size", "title"], description: "Sort order for children." },
        },
        required: [] as string[],
      },
    },
    {
      name: "read",
      description: "Read section content. Single ID or array (max 20). Supports offset/limit pagination.",
      input_schema: {
        type: "object" as const,
        properties: {
          id: { description: "Section ID (slug/UUID) or array of IDs (max 20)." },
          depth: { type: "number", description: "0=section only (default), 1+=include children content." },
          offset: { type: "number", description: "Char offset for pagination." },
          limit: { type: "number", description: "Max chars per section (default 10000, max 15000)." },
          format: { type: "string", enum: ["markdown", "plain"], description: "Content format (default markdown)." },
        },
        required: ["id"],
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
          after_id: { type: "string", description: "Place after this sibling. Omit to append at end." },
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
      name: "bulk_update_sections",
      description: "Update multiple sections at once (title and/or content).",
      input_schema: {
        type: "object" as const,
        properties: {
          sections: {
            type: "array",
            description: "Sections to update",
            items: {
              type: "object",
              properties: {
                section_id: { type: "string", description: "Section UUID" },
                title: { type: "string", description: "New title (omit to keep)" },
                content: { type: "string", description: "New markdown (omit to keep)" },
              },
              required: ["section_id"],
            },
          },
        },
        required: ["sections"],
      },
    },
    {
      name: "patch_section",
      description: "Apply targeted edits to a section without reading it first. Use instead of read → update_section when you know exactly what to change.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_id: { type: "string", description: "Section UUID or slug" },
          patches: {
            type: "array",
            description: "List of patches to apply sequentially",
            items: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["replace_heading", "append", "prepend", "insert_after", "delete_heading"],
                  description: "replace_heading: replace content under a heading; append: add to end; prepend: add to start; insert_after: insert new content after a heading's block; delete_heading: remove heading and its content",
                },
                heading: { type: "string", description: "Target heading text e.g. '## Architecture' (for replace/insert_after/delete)" },
                content: { type: "string", description: "New markdown content (for replace/append/prepend/insert_after)" },
              },
              required: ["action"],
            },
          },
        },
        required: ["section_id", "patches"],
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
      name: "reorder_children",
      description: "Reorder children of a parent section. Provide IDs in desired order.",
      input_schema: {
        type: "object" as const,
        properties: {
          parent_id: { type: "string", description: "Parent section ID (null for root)" },
          ordered_ids: { type: "array", items: { type: "string" }, description: "Child IDs in desired order" },
        },
        required: ["ordered_ids"],
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
      name: "delete_sections",
      description: "Batch soft-delete multiple sections. Prefer over multiple delete_section calls.",
      input_schema: {
        type: "object" as const,
        properties: {
          section_ids: { type: "array", items: { type: "string" }, description: "Section IDs (slug/UUID), max 50." },
        },
        required: ["section_ids"],
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
 * Builds semantic search tool (available when source code access is enabled).
 */
function buildSemanticSearchTool(): ToolDefinition[] {
  return [{
    name: "semantic_search",
    description: "Search code and documentation by meaning, not just keywords. Returns the most relevant code snippets and doc sections. Prefer this over search_project_files for conceptual queries like 'how does plan generation work' or 'context compression logic'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural language description of what you're looking for. Examples: 'plan generation logic', 'how context is compressed', 'tool execution and caching'",
        },
        top_k: {
          type: "number",
          description: "Number of results to return (default: 5, max: 15).",
        },
        filter: {
          type: "string",
          enum: ["all", "code", "docs"],
          description: "Filter results by type (default: all).",
        },
      },
      required: ["query"],
    },
  }];
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
 * Builds the run_agent tool (only when custom agents exist).
 */
function buildAgentTool(agents: CustomAgent[]): ToolDefinition[] {
  if (agents.length === 0) return [];
  return [{
    name: "run_agent",
    description: "Run a custom agent in isolated context. " +
      agents.map(a => `${a.name} (id:${a.id}): ${a.description}`).join("; "),
    input_schema: {
      type: "object" as const,
      properties: {
        agent_id: {
          type: "string",
          description: "Agent ID",
          enum: agents.map(a => a.id),
        },
        task: {
          type: "string",
          description: "Task description for the agent",
        },
      },
      required: ["agent_id", "task"],
    },
  }];
}

/**
 * Builds the rate_agent tool (only when custom agents exist).
 */
function buildRateAgentTool(agents: CustomAgent[]): ToolDefinition[] {
  if (agents.length === 0) return [];
  return [{
    name: "rate_agent",
    description: "Rate an agent's performance after using it. Score 0-10, optionally describe issues.",
    input_schema: {
      type: "object" as const,
      properties: {
        agent_id: { type: "string", description: "Agent ID to rate" },
        score: { type: "number", description: "Score 0-10 (10=perfect, 0=useless)" },
        issues: { type: "string", description: "Problems encountered (optional)" },
      },
      required: ["agent_id", "score"],
    },
  }];
}

/**
 * Builds session buffer tools (always available — shared between assistant and agents).
 */
function buildBufferTools(): ToolDefinition[] {
  return [
    {
      name: "write_buffer",
      description: "Write data to the session buffer (shared between assistant and all agents). Use for findings, analysis results, or data that other agents may need later. Returns a brief confirmation — the content itself stays in the buffer.",
      input_schema: {
        type: "object" as const,
        properties: {
          key: { type: "string", description: "Unique key (e.g. 'db-schema', 'api-analysis'). Overwrites if key exists." },
          content: { type: "string", description: "The data to store (up to 30K chars)." },
          summary: { type: "string", description: "1-2 sentence summary. Shown in list_buffer." },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for categorization." },
        },
        required: ["key", "content", "summary"],
      },
    },
    {
      name: "read_buffer",
      description: "Read a specific entry from the session buffer by key. Supports offset/limit pagination for large entries.",
      input_schema: {
        type: "object" as const,
        properties: {
          key: { type: "string", description: "Buffer entry key to read." },
          offset: { type: "number", description: "Char offset to continue reading (default 0)." },
          limit: { type: "number", description: "Max chars to return (default 10000, max 15000)." },
        },
        required: ["key"],
      },
    },
    {
      name: "list_buffer",
      description: "List all session buffer entries (keys, summaries, authors, sizes). Does NOT return content — use read_buffer for that.",
      input_schema: {
        type: "object" as const,
        properties: {
          tag: { type: "string", description: "Optional: filter entries by tag." },
        },
        required: [] as string[],
      },
    },
  ];
}

/**
 * Builds plan management tools (always available).
 */
function buildPlanTools(): ToolDefinition[] {
  return [
    {
      name: "create_plan",
      description: "Create a work plan for a complex task. Shows as a checklist in chat. Use for tasks with 3+ steps. Plan progress is tracked automatically via [PLAN:] markers in your text — no update tool needed. IMPORTANT: After completing all plan steps, you MUST verify the result 2-3 times for correctness and plan compliance before reporting completion.",
      input_schema: {
        type: "object" as const,
        properties: {
          steps: {
            type: "array",
            items: { type: "string" },
            description: "List of plan steps. The last step MUST always be a verification step: 'Verify: check all steps are completed correctly, fix any issues found'",
          },
        },
        required: ["steps"],
      },
    },
    // update_plan is handled via text markers [PLAN: 0=done, 1=in_progress] — parsed by engine.
    // Tool executor still handles "update_plan" calls for backwards compatibility with old sessions.
  ];
}

/**
 * Assembles the full tool set based on configuration flags.
 */
export function buildTools(params: {
  includeSourceCode: boolean;
  planMode: boolean;
  webSearchEnabled?: boolean;
  customAgents?: CustomAgent[];
}): ToolDefinition[] {
  const { includeSourceCode, planMode, webSearchEnabled, customAgents } = params;

  const tools: ToolDefinition[] = [
    ...buildCoreTools(),
    ...buildBufferTools(),
    ...buildPlanTools(),
    buildAskUserTool(),
    ...(includeSourceCode ? buildSourceCodeTools() : []),
    ...(includeSourceCode ? buildSemanticSearchTool() : []),
  ];

  if (webSearchEnabled) {
    tools.push(...buildWebSearchTools());
  }

  if (customAgents && customAgents.length > 0) {
    tools.push(...buildAgentTool(customAgents));
    tools.push(...buildRateAgentTool(customAgents));
  }

  if (planMode) return tools.filter(t => isPlanModeTool(t.name));

  return tools;
}

/**
 * Human-readable descriptions for tool progress display in UI.
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  gt: "Navigating tree",
  read: "Reading content",
  search: "Searching documentation",
  create_section: "Creating section",
  bulk_create_sections: "Creating sections",
  update_section: "Updating section",
  delete_section: "Deleting section",
  delete_sections: "Deleting sections",
  move_section: "Moving section",
  bulk_update_sections: "Updating multiple sections",
  patch_section: "Patching section",
  reorder_children: "Reordering sections",
  duplicate_section: "Duplicating section",
  restore_section: "Restoring section",
  update_icon: "Updating icon",
  commit_version: "Saving version",
  get_history: "Viewing version history",
  restore_version: "Restoring version",
  create_backup: "Creating backup",
  list_backups: "Checking backups",
  get_section_at_version: "Reading section version",
  get_project_tree: "Browsing project files",
  get_file_outlines: "Reading file outlines",
  read_project_file: "Reading source code",
  search_project_files: "Searching code",
  find_symbols: "Finding code symbols",
  semantic_search: "Semantic search across code and docs",
  web_search: "Searching the web",
  ask_user: "Asking a clarifying question",
  run_agent: "Running agent",
  rate_agent: "Rating agent performance",
  create_plan: "Creating work plan",
  update_plan: "Updating work plan",
  write_buffer: "Writing to session buffer",
  read_buffer: "Reading from session buffer",
  list_buffer: "Listing session buffer",
};
