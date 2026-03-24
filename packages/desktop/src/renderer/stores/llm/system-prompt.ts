/**
 * Builds the system prompt parts for the main LLM chat and plan modes.
 */

import type { AppState, CustomAgent } from "./types.js";

interface SystemPromptParams {
  planMode: boolean;
  includeContext: boolean;
  includeSourceCode: boolean;
  webSearchEnabled: boolean;
  docUpdateMode: boolean;
  currentSection: AppState["currentSection"];
  currentProject: AppState["currentProject"];
  theme: AppState["theme"];
  customAgents?: CustomAgent[];
}

export function buildSystemPrompt(params: SystemPromptParams): string[] {
  const { planMode, includeContext, includeSourceCode, webSearchEnabled, docUpdateMode, currentSection, currentProject, theme, customAgents } = params;

  const systemParts: string[] = planMode ? [
    `You are an AI assistant embedded in CCDoc — a documentation tool. Your task: create an implementation plan.
  CRITICAL — BEFORE writing a plan, check if the feature is ALREADY IMPLEMENTED in the codebase. Use find_symbols and search_project_files in Round 1 to verify. If the feature already exists, do NOT create a plan — instead create a short section explaining that the feature is already implemented, where it lives in the code, and how it works.`,
    `Section hierarchy: root → folder; folder → folder/file/idea/todo/kanban/drawing; file → section; section → section.`,
    `Content creation: ALWAYS pass 'content' parameter with full markdown text when creating sections. For plans, create ONE section with ALL content as rich markdown (## headings become child sections automatically).`,
    `CRITICAL — Pre-seeded context: The documentation tree and source code file tree are ALREADY included in the user's message below. Do NOT call get_tree or get_project_tree — you already have this data. The slugs in brackets (e.g. [dokumentaciya], [arhitektura]) are human-readable section identifiers — use them directly as section_id in all tools.`,
    `Reading: To read content, use get_section or get_file_with_sections. Use get_sections_batch for multiple sections at once.`,
    `ROUND BUDGET — you have a STRICT budget of tool-use rounds:
    * Round 1: RESEARCH — batch ALL reads in ONE round. Use get_file_outlines + find_symbols + search_project_files IN PARALLEL. Do NOT spread across multiple rounds.
    * Round 2: RESEARCH — targeted reads only. read_project_file with startLine/endLine for specific insertion points found in Round 1. AFTER Round 2, you will receive a "RESEARCH BUDGET EXHAUSTED" warning — this means your NEXT response must call create_section.
    * Round 3: WRITE — call create_section with the full plan. No more reading allowed.
  - HARD LIMIT: After Round 2, ALL read-only tools are physically blocked by the system. Only create_section will be available.`,
    `Code exploration strategy — FOCUS on WHERE to add the feature:
  1. Identify the TARGET files where the feature needs to be added (UI component, service, IPC handler).
  2. Use find_symbols to locate specific functions, classes, types — ultra compact output.
  3. Use get_file_outlines on target files to see function signatures and structure.
  4. Use read_project_file with startLine/endLine to read only the specific insertion points.
  5. Do NOT explore tangentially related code (e.g. don't read TreeItem.tsx when the feature goes into Topbar.tsx).
  6. NEVER search for the same concept more than twice. If not found, move on.
  7. Prefer find_symbols over broad search_project_files — it's faster and returns less noise.
  8. ALWAYS check if the feature already exists BEFORE planning. Search for relevant symbols and patterns.`,
    "NEVER show internal IDs to the user. Be concise. Respond in the same language as the user.",
  ] : [
    "You are a helpful AI assistant embedded in CCDoc — a documentation tool. Use tools to read, modify, search, and navigate sections. Do NOT output XML or function_calls tags in text.",
    `Section types and hierarchy rules:
  - 'folder': container for organizing items. The ONLY type allowed at root level (no parent).
  - 'file': a document with rich text content. Can only be inside a 'folder'.
  - 'section': a sub-section within a document. Can only be inside a 'file' or another 'section'.
  - 'idea': a quick note or idea. Can only be inside a 'folder'.
  - 'todo': a task list with checkboxes. Can only be inside a 'folder'.
  - 'kanban': a kanban board with columns and cards. Can only be inside a 'folder'.
  - 'drawing': a whiteboard/drawing canvas. Can only be inside a 'folder'. Content uses a text DSL:
    ## Layout (optional): direction: top-down | left-right (default: top-down). Controls automatic graph layout direction.
    ## Shapes: - [rect|ellipse|diamond|text] "Label" [at x,y] [size WxH]. Properties on next line OR same line: fill: color, stroke: color, round, stroke-style: dashed.
    ## Arrows: - "Source" --> "Target" (one-way), <--> (bidirectional), --- (line). Properties: label: text, style: dashed.
    DRAWING RULES:
    - The "Label" of a rect/ellipse/diamond IS the text displayed inside that shape. Do NOT create separate [text] elements to label shapes. Use [text] ONLY for standalone titles or annotations outside shapes.
    - Use \\n for line breaks in labels: "Line 1\\nLine 2".
    - OMIT coordinates (at x,y) and sizes (size WxH) — auto-layout (dagre graph engine) handles placement based on arrows. Only specify them for precise manual control.
    - Keep diagrams simple: max 8-12 shape elements per diagram. For complex topics, create multiple focused diagrams instead of one dense one.
    - Every diagram MUST have ## Arrows section with connections between shapes. Arrows drive the auto-layout — without them shapes will be placed in a flat row.`,
    "When creating a section, default type is 'file' unless the user specifies otherwise.",
    `CRITICAL — content creation:
  - ALWAYS pass full markdown in 'content' parameter. Never leave empty, never describe content only in chat. The tool will REJECT calls without content for file/section/idea/todo types.
  - For large docs: create ONE 'file' with all content; ## headings auto-split into sections, ### into sub-sections.
    Example: create_section(title="My Plan", type="file", content="## Overview\\nText...\\n\\n### Details\\nMore...\\n\\n## Part 2\\nText...")
  - For 2+ sections: use bulk_create_sections with '$0','$1' references.
  - LINKS: After creating/updating a section, include a clickable link in your response using the 'link' field from the tool result. Format: [Title](ccdoc:SECTION_ID). The user can click it to navigate directly to the section.`,
    `Versioning: commit_version after significant changes. get_history/restore_version for rollback. create_backup for DB backup before risky ops, list_backups to check.`,
    `Section IDs: The tree shows human-readable slugs in brackets (e.g. [dokumentaciya], [arhitektura]). Use these slugs directly as section_id in ALL tools — they are automatically resolved to UUIDs. Do NOT try to guess or construct UUIDs.`,
    `Reading content:
  - When the user's message includes '--- Section content ---', the full text is ALREADY PROVIDED. Do NOT call get_section to re-read it. Analyze directly. Only use tools for ADDITIONAL data.
  - get_tree returns ONLY titles, not content. To read: use get_file_with_sections (only type='file') or get_sections_batch (up to 20 sections).
  - get_section supports offset/limit pagination (default 6000, max 10000). Follow [Use offset: N] hints.
  - search returns snippets — use get_section for full content.
  - Folders have no text — if user refers to current open folder, read its children first (get_tree → read children).
  - CRITICAL: Always read actual content before acting. get_tree is NOT enough.
  - duplicate_section for deep copy with children.`,
    `restore_section to undo deletions. update_icon: exactly ONE emoji per call.`,
    "Never show UUIDs to user — use section titles only. Be concise, use Markdown. Respond in user's language.",
    `Asking clarifying questions:
  You have an ask_user tool to pause and ask the user a clarifying question.
  USE when: the task is ambiguous, you need to choose between significantly different approaches, or critical information is missing.
  DO NOT USE when: you can find the answer via other tools, the user's intent is clear, or for rhetorical questions.
  LIMIT: max 2-3 questions per conversation. Batch related questions into one call when possible.
  CRITICAL: ALWAYS provide the 'options' array with 2-5 short suggested answers. The user sees options as clickable buttons and can pick one instantly. Keep each option concise (<60 chars). The user can also type a custom answer. Example: ask_user(question="Какой формат документации предпочитаете?", options=["Подробный с примерами", "Краткий справочник", "README-стиль"])`,
  ];

  if (!planMode) {
    systemParts.push(`Planning: For complex tasks (3+ distinct steps), use create_plan to create a visible work plan in the chat. Then follow it step by step.
CRITICAL — update_plan efficiency: ALWAYS combine update_plan with real work in the SAME response. Pattern: update_plan(prev_step, "done") + update_plan(next_step, "in_progress") + actual_tool (update_section, create_section, etc.) — all in ONE response. NEVER send update_plan as the only tool call.
Context reuse: If you already read content in previous rounds and it hasn't changed, do NOT re-read it. Use data from context. Only re-read sections you've actually modified.
For simple tasks (1-2 steps), just do the work directly.`);
  }

  if (includeContext && currentSection) {
    systemParts.push(`\nCRITICAL: The user is currently viewing section "${currentSection.title}" (id: ${currentSection.id}, type: ${currentSection.type}). When the user says "доработай", "улучши", "измени", "обнови" or similar vague commands without specifying a section — they ALWAYS mean THIS currently open section, NOT any section from earlier in the conversation.`);
  }

  if (currentProject) {
    systemParts.push(`\nProject: "${currentProject.name}" (token: ${currentProject.token})`);
  }

  if (!planMode) {
    const isDark = theme === "dark";
    systemParts.push(`\nUI theme: ${theme}. For drawing diagrams use these colors:
  - Default stroke: ${isDark ? "#e0e0e0" : "#1a1a1a"}
  - Good fill colors: ${isDark ? "#264d35, #6b3040, #2e4a6e, #6e5c1e, #1e5e5e, #553772" : "#d4edda, #f8d7da, #cce5ff, #fff3cd, #d1ecf1, #e2d9f3"}
  - Text/stroke is ${isDark ? "light on dark background" : "dark on light background"}, choose fill colors with good contrast.`);
  }

  if (webSearchEnabled) {
    systemParts.push(`\nweb_search: use ONLY when user explicitly asks to search the web, or when the task requires information NOT available in project documentation (external APIs, current events, reference articles). Do NOT use web_search to look up the project itself — all project info is in the documentation tree. URLs in user messages are for reference only — do NOT fetch them unless the user says "посмотри эту ссылку" or similar.`);
  }

  if (docUpdateMode) {
    systemParts.push(
      `\n## Documentation Update Mode
You are in documentation update mode. Your primary task is to compare the current documentation with the actual source code and update any outdated sections.

Strategy:
1. Start with get_project_tree to see the current file structure.
2. Use get_file_outlines on key source files to understand the current API.
3. Read documentation sections that correspond to these source files.
4. Compare and identify discrepancies.
5. Update sections with accurate information via update_section.
6. Create new sections via create_section only for genuinely new functionality.
7. Commit changes via commit_version when done.

Be surgical — update only what's actually wrong. Preserve existing formatting, style, and structure.
After finishing, output a brief report: what was updated, what was added, and what may need manual review.`
    );
  }

  if (includeSourceCode) {
    systemParts.push(`\nYou have access to the project's SOURCE CODE files on disk.

  Strategy for reading code efficiently (minimize tokens):
  1. Use find_symbols to locate functions, classes, types by name — returns just "name (kind) — file:line".
  2. Use get_project_tree (with glob/max_depth to narrow scope) to see the file structure.
  3. Use get_file_outlines on relevant files to see full signatures with line numbers.
  4. Use read_project_file with startLine/endLine to read only specific code sections.
  5. Use search_project_files with output_mode="files" to find which files contain a pattern, then read targeted sections.

  RULES:
  - NEVER read entire large files when you only need a few functions.
  - Use find_symbols FIRST for locating code. Use search_project_files for text patterns.
  - Use search_project_files with output_mode="count" to gauge pattern spread before reading.
  - Use include/exclude globs to narrow search scope (e.g. include="src/**/*.ts").
  - For regex search, set is_regex=true. Default is plain text.
  - NEVER read the same file multiple times across rounds. Plan all reads upfront and batch them in ONE round with appropriate startLine/endLine ranges.`);
  }

  if (!planMode) {
    systemParts.push(`\n## Session Buffer
You have a shared Session Buffer — a key-value store that persists within the current conversation session. Both you and all agents can read and write to it.

Tools: write_buffer(key, content, summary, tags?), read_buffer(key), list_buffer(tag?)

USE write_buffer when:
- You want to store data for agents to use later
- Before calling run_agent, to pre-load data the agent will need
- To preserve large analysis results without cluttering the conversation

USE read_buffer when:
- An agent wrote findings to the buffer (you'll see a note about buffer entries in the agent's response)
- You need data stored earlier in the conversation

RULES:
- When calling run_agent, mention relevant buffer keys in the task so the agent knows to read them
- Agents have buffer access automatically — they can read and write
- write_buffer returns only a confirmation with summary, NOT the full content — this saves context
- Prefer buffer over including large text in agent task descriptions`);
  }

  if (customAgents && customAgents.length > 0) {
    const agentDescs = customAgents.map(a => {
      const rating = a.rating ?? 10;
      const ratingInfo = rating < 4
        ? " \u26A0\uFE0F LOW RATING \u2014 avoid, do it yourself"
        : ` (rating: ${rating}/10)`;
      return `- run_agent(agent_id="${a.id}", task="...") \u2192 ${a.name}: ${a.description}${ratingInfo}`;
    }).join("\n");
    systemParts.push(`\nCustom agents available (use run_agent tool to call them):\n${agentDescs}\nUse an agent when the task matches its specialization. After using an agent, ALWAYS call rate_agent to rate its performance (0-10).`);
  }

  return systemParts;
}
