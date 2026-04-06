import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";

const PROJECT_MARKER_DIR = ".ccdoc";
const PROJECT_TOKEN_FILE = "project.token";

function detectToken(projectPath: string): string | null {
  const tokenFile = join(projectPath, PROJECT_MARKER_DIR, PROJECT_TOKEN_FILE);
  if (existsSync(tokenFile)) {
    return readFileSync(tokenFile, "utf-8").trim();
  }
  return null;
}

function generateFiles(token: string, mcpServerPath: string): Map<string, string> {
  const files = new Map<string, string>();

  // --- MCP config (will be merged into settings.json) ---
  files.set("__mcp_config__", JSON.stringify({
    command: "node",
    args: [mcpServerPath, "--allow-write"],
  }));

  // --- Commands ---

  files.set(".claude/commands/tree.md", `Show the ccDoc project documentation tree.

Use the MCP tool \`overview\` with project_token "${token}". It will return the project passport and a compact tree (depth 2).

Display the result as a readable tree with indentation and type icons:
- 📁 folder
- 📄 file
- 📝 section
- 💡 idea
- ✅ todo
- 📋 kanban
- 🎨 drawing

If a project passport exists, show it at the beginning.

$ARGUMENTS
`);

  files.set(".claude/commands/search.md", `Search the ccDoc project documentation.

Use the MCP tool \`find\` with project_token "${token}" and the query below.

Show results with paths, relevance, and snippets.
If full details are needed, use \`read\` for the specific section.
If the query is empty, ask what to search for.

Query: $ARGUMENTS
`);

  files.set(".claude/commands/section.md", `Read a section from the ccDoc project.

1. Use \`find\` with project_token "${token}" and the section name below as a query
2. Use \`read\` with the found section_id to get the full content and child sections

If the name is ambiguous, show matching options and ask the user to clarify.

Section: $ARGUMENTS
`);

  files.set(".claude/commands/create-doc.md", `Create a structured document in the ccDoc project.

Steps:
1. \`overview\` with project_token "${token}" — review the current structure
2. Choose an appropriate folder or suggest creating a new one
3. \`create_section\` — create a section with type "file" in the chosen folder with full markdown content
4. Create subsections with type "section" for each major part of the document

Hierarchy rules:
- Root level: folders only
- Folders contain: folders, files, ideas, todos, kanban, drawing
- Files contain: sections
- Sections contain: sections (for nesting)

Write content in markdown format.
After creation, call \`commit_history\` with a descriptive message.

AFTER COMPLETING ALL STEPS:
- Verify each created element: correct types, hierarchy, and content
- Ensure markdown formatting is valid
- Verify that all subsections are created and attached to the correct parents
If errors are found, fix them and verify again.

Topic/requirements: $ARGUMENTS
`);

  files.set(".claude/commands/import.md", `Import markdown content into the ccDoc project.

Steps:
1. \`overview\` with project_token "${token}" — review available folders
2. Clarify the target folder if not specified below
3. \`import_markdown\` with project_token "${token}", the target folder's folder_id, a file name, and the markdown content

The tool automatically splits markdown into sections by headings.

If the user specified a file path, read the file's content.
If raw markdown is provided, use it directly.

After import, call \`commit_history\` with a description.

What to import: $ARGUMENTS
`);

  files.set(".claude/commands/scaffold.md", `Create a documentation structure in the ccDoc project in a single call.

Steps:
1. \`overview\` with project_token "${token}" — review the current structure
2. Plan the folder, file, and section structure based on the requirements below
3. \`bulk_create_sections\` with project_token "${token}" — create everything in one call
   - Use '$N' references for parent_id (0-indexed, referencing the Nth created section in the batch)
   - Example: '$0' refers to the first created section

Hierarchy rules: root->folder, folder->file/idea/todo/kanban/drawing, file->section, section->section

After creation, call \`commit_history\` with a description.

AFTER COMPLETION:
- Verify that all sections were created with correct types and hierarchy
- Verify that parent_id references are correct
If errors are found, fix them and verify again.

Structure to create: $ARGUMENTS
`);

  files.set(".claude/commands/review.md", `Analyze the ccDoc project documentation structure.

Steps:
1. \`overview\` with project_token "${token}" — structure and passport
2. Evaluate the organization:
   - Logical consistency of the folder hierarchy
   - Naming consistency
   - Folders with too many or too few elements
   - Opportunities to group flat structures
   - Documentation gaps
3. Read key sections via \`read\` to assess content quality
4. Provide specific improvement recommendations

If a focus area is specified, prioritize that area.

Focus: $ARGUMENTS
`);

  files.set(".claude/commands/summarize.md", `Summarize the ccDoc project documentation.

If a specific section is specified:
1. \`find\` with project_token "${token}" — locate the section
2. \`read\` — read the full content

If no section is specified, summarize the entire project:
1. \`overview\` with project_token "${token}" — structure and passport
2. Read key sections via \`read\`
3. Provide a high-level overview

Output:
- Brief summary (2-3 sentences)
- Key topics
- Important decisions and details
- Documentation gaps

What to summarize: $ARGUMENTS
`);

  files.set(".claude/commands/history.md", `Show the ccDoc project version history.

Use \`commit_history\` to create snapshots and \`get_history\` (legacy) to view history.

Project token: "${token}"

$ARGUMENTS
`);

  files.set(".claude/commands/execute-plan.md", `Execute a plan from the ccDoc project.

1. Use \`find\` with project_token "${token}" and the query below to locate the plan
2. Use \`read\` to get the full plan content and all its phases/steps
3. Execute each step of the plan STRICTLY in order, without skipping any item
4. After completing all steps, perform at least TWO verification iterations:
   Iteration 1: check compliance with the plan -> check for errors -> fix issues found.
   Iteration 2: re-check compliance with the plan -> re-check for errors -> fix issues.
5. Do NOT report completion until both iterations have passed

RULES:
- Do not skip plan steps
- Do not change the execution order without an explicit reason
- Do not add unplanned functionality
- Pay close attention to file names, paths, types, and signatures

Plan: $ARGUMENTS
`);

  // --- Agent ---

  files.set(".claude/agents/ccdoc.md", `---
name: ccdoc
description: "ccDoc documentation assistant — manages project documentation structure, creates and edits documents, searches content, and tracks version history using the ccDoc MCP server."
model: sonnet
---

You are a documentation specialist working with the ccDoc documentation management system.

## Project context

Project token: ${token}

Documentation is organized hierarchically:
- **Folders** (root level only) — organizational containers
- **Files** (inside folders) — documents with content
- **Sections** (inside files or other sections) — parts of a document
- **Ideas** (inside folders) — quick notes
- **Todos** (inside folders) — task lists
- **Kanban** (inside folders) — kanban boards
- **Drawing** (inside folders) — diagrams

## Available MCP tools

### Reading (funnel: orient -> search -> read)
- \`overview\` — **entry point**. Returns the project passport and a compact tree (depth 2). Call once at the start.
- \`find\` — **primary tool** for searching. Returns snippets with section paths. Often a snippet is sufficient.
- \`read\` — full section content by ID. Use only when a snippet from find is not enough.
- \`list_projects\` — list of projects

### Writing
- \`create_section\` — create a section
- \`update_section\` — update title and/or content
- \`delete_section\` — soft delete
- \`move_section\` — move within the tree
- \`import_markdown\` — import markdown
- \`bulk_create_sections\` — bulk creation
- \`export_project\` — export to markdown files
- \`commit_history\` — save a version snapshot

## Working principles

1. **overview -> find -> read** — follow the funnel. Start with overview to orient, use find to search, read only for full details.
2. **Snippets are often enough** — find returns short snippets; do not read the full section if the answer is visible in the snippet.
3. **Respect the hierarchy** — root->folder, folder->file/idea/todo/kanban/drawing, file->section, section->section
4. **Commit after changes** — call \`commit_history\` after significant modifications
5. **Read before updating** — always read the current content via \`read\` before calling update_section
`);

  return files;
}

function mergeAndWriteSettings(projectPath: string, mcpConfigJson: string): void {
  const settingsPath = join(projectPath, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      const backupPath = settingsPath + ".bak";
      writeFileSync(backupPath, readFileSync(settingsPath, "utf-8"));
      console.warn(`Backed up corrupted settings.json to ${backupPath}`);
    }
  }

  if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
    settings.mcpServers = {};
  }
  (settings.mcpServers as Record<string, unknown>).ccdoc = JSON.parse(mcpConfigJson);

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function runInstall(): void {
  const projectPath = resolve(process.argv[2] || ".");

  const token = detectToken(projectPath);
  if (!token) {
    console.error(`Error: No ccDoc project found at ${projectPath}`);
    console.error(`Expected token file at ${projectPath}/.ccdoc/project.token`);
    process.exit(1);
  }

  const mcpServerPath = resolve(dirname(__filename), "index.js").replace(/\\/g, "/");

  const files = generateFiles(token, mcpServerPath);
  const created: string[] = [];

  // Handle settings.json merge
  const mcpConfigJson = files.get("__mcp_config__");
  files.delete("__mcp_config__");
  if (mcpConfigJson) {
    mergeAndWriteSettings(projectPath, mcpConfigJson);
    created.push(".claude/settings.json");
  }

  // Write all other files
  for (const [relPath, content] of files) {
    const fullPath = join(projectPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    created.push(relPath);
  }

  console.log(`Claude Code plugin installed for ccDoc project (token: ${token})`);
  console.log(`Created ${created.length} files:`);
  for (const f of created) {
    console.log(`  ${f}`);
  }
}

// Auto-run when executed directly
runInstall();
