import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { PROJECT_MARKER_DIR, PROJECT_TOKEN_FILE } from "../constants.js";

export class InstallService {
  detectToken(projectPath: string): string | null {
    const tokenFile = join(projectPath, PROJECT_MARKER_DIR, PROJECT_TOKEN_FILE);
    if (existsSync(tokenFile)) {
      return readFileSync(tokenFile, "utf-8").trim();
    }
    return null;
  }

  generateFiles(token: string, mcpServerPath: string): Map<string, string> {
    const files = new Map<string, string>();

    // --- Settings.json (MCP config only — will be merged) ---
    files.set("__mcp_config__", JSON.stringify({
      command: "node",
      args: [mcpServerPath, "--allow-write"],
    }));

    // --- CLAUDE.md ---

    files.set("CLAUDE.md", `# ccDoc Documentation System

This project uses [ccDoc](https://github.com/anthropics/ccdoc) for documentation management via MCP.

**Project token:** \`${token}\`

## Available slash commands

| Command | Description |
|---------|-------------|
| \`/tree\` | Show documentation tree structure |
| \`/search <query>\` | Search documentation content |
| \`/section <name>\` | Read a specific section |
| \`/create-doc <topic>\` | Create a new structured document |
| \`/import <source>\` | Import markdown content |
| \`/scaffold <structure>\` | Create documentation structure in bulk |
| \`/review [focus]\` | Analyze documentation quality |
| \`/summarize [section]\` | Summarize documentation |
| \`/history\` | Show version history |

## MCP tools (via ccdoc server)

**Read:** \`list_projects\`, \`overview\`, \`find\`, \`read\`

**Write:** \`create_section\`, \`update_section\`, \`delete_section\`, \`move_section\`, \`import_markdown\`, \`bulk_create_sections\`, \`export_project\`, \`commit_history\`

All MCP tools require \`project_token: "${token}"\`.

## Documentation hierarchy

- **Root** → folders only
- **Folders** → files, ideas, todos, kanban, excalidraw
- **Files** → sections
- **Sections** → sections (nested)

Always call \`commit_history\` after making changes.
`);

    // --- Commands ---

    files.set(".claude/commands/tree.md", `Show the ccDoc project documentation tree.

Use the MCP tool \`overview\` with project_token "${token}". It returns the compact tree (depth 2) and project passport.

Display the result as a readable tree with indentation and type icons:
- 📁 folder
- 📄 file
- 📝 section
- 💡 idea
- ✅ todo
- 📋 kanban
- 🎨 excalidraw

$ARGUMENTS
`);

    files.set(".claude/commands/search.md", `Search the ccDoc project documentation.

Use the MCP tool \`find\` with project_token "${token}" and the query below.

Show results with paths, relevance scores, and content snippets.
If the query is empty — ask what to search for.
If full content is needed — use \`read\` with the found section_id.

Query: $ARGUMENTS
`);

    files.set(".claude/commands/section.md", `Read a section from the ccDoc project.

1. Use \`find\` with project_token "${token}" and the section name below as query
2. Use \`read\` with the found section_id to get its full content

If the name is ambiguous — show matching options and ask the user to clarify.

Section: $ARGUMENTS
`);

    files.set(".claude/commands/create-doc.md", `Create a structured document in the ccDoc project.

Steps:
1. \`overview\` with project_token "${token}" — review the current structure
2. Choose an appropriate folder or suggest creating a new one
3. \`create_section\` — create a section of type "file" in the chosen folder with full markdown content
4. Create child sections of type "section" for each main part of the document

Hierarchy rules:
- Root level: folders only
- Folders contain: folders, files, ideas, todos, kanban, excalidraw
- Files contain: sections
- Sections contain: sections (for nesting)

Write content in markdown format.
After creation — call \`commit_history\` with a descriptive message.

Topic/requirements: $ARGUMENTS
`);

    files.set(".claude/commands/import.md", `Import markdown content into the ccDoc project.

Steps:
1. \`overview\` with project_token "${token}" — review available folders
2. Clarify the target folder if not specified below
3. \`import_markdown\` with project_token "${token}", folder_id of the target folder, filename, and markdown content

The tool automatically splits markdown into sections by headings.

If the user specified a file path — read the file contents.
If raw markdown is provided — use it directly.

After import — call \`commit_history\` with a description.

What to import: $ARGUMENTS
`);

    files.set(".claude/commands/scaffold.md", `Create a documentation structure in the ccDoc project in a single call.

Steps:
1. \`overview\` with project_token "${token}" — current structure
2. Plan the folder, file, and section structure based on the requirements below
3. \`bulk_create_sections\` with project_token "${token}" — create everything in one call
   - Use '$N' references for parent_id (0-indexed, refers to the N-th created section in the batch)
   - Example: '$0' refers to the first created section

Hierarchy rules: root→folder, folder→file/idea/todo/kanban/excalidraw, file→section, section→section

After creation — \`commit_history\` with a description.

Structure to create: $ARGUMENTS
`);

    files.set(".claude/commands/review.md", `Analyze the ccDoc project documentation structure.

Steps:
1. \`overview\` with project_token "${token}" — full structure
2. Evaluate the organization:
   - Logical folder hierarchy
   - Naming consistency
   - Folders with too many or too few items
   - Opportunities to group flat structures
   - Documentation gaps
3. Read key sections via \`read\` to assess content quality
4. Provide specific improvement recommendations

If a focus area is specified — prioritize that area.

Focus: $ARGUMENTS
`);

    files.set(".claude/commands/summarize.md", `Summarize the ccDoc project documentation.

If a specific section is specified:
1. \`find\` with project_token "${token}" — find the section
2. \`read\` — get its full content

If no section is specified — summarize the entire project:
1. \`overview\` with project_token "${token}" — structure
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

Use \`commit_history\` with project_token "${token}" to create a snapshot, or check git log of the project directory to view past commits.

Display the history in a readable format:
- Date and time
- Commit message
- OID (abbreviated)

$ARGUMENTS
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
- **Excalidraw** (inside folders) — diagrams

## Available MCP tools

### Read
- \`list_projects\` — list projects
- \`overview\` — project passport + compact tree (depth 2). Call first to orient yourself.
- \`find\` — **primary tool** for finding information. Returns snippets with breadcrumb paths.
- \`read\` — full content of a section by ID. Use after \`find\` when snippet is not enough.

### Write
- \`create_section\` — create a section
- \`update_section\` — update title and/or content
- \`delete_section\` — soft delete
- \`move_section\` — move within the tree
- \`import_markdown\` — import markdown (auto-splits by headings)
- \`bulk_create_sections\` — bulk creation with \`$N\` batch references
- \`export_project\` — export to markdown files
- \`commit_history\` — save a version snapshot

## Working principles

1. **Find first** — use \`find\` to locate content, not \`overview\`. Use \`overview\` only when you need the tree for create/move operations.
2. **Follow the hierarchy** — root→folder, folder→file/idea/todo/kanban/excalidraw, file→section, section→section
3. **Commit after changes** — call \`commit_history\` after significant modifications
4. **Read before updating** — always use \`read\` to get current content before \`update_section\`
5. **One file, full content** — prefer creating a single file with full markdown (auto-split by headings) over many small sections
`);

    return files;
  }

  install(projectPath: string, token: string, mcpServerPath: string): { created: string[]; updated: string[] } {
    const files = this.generateFiles(token, mcpServerPath);
    const created: string[] = [];
    const updated: string[] = [];

    // Merge settings.json
    const mcpConfigJson = files.get("__mcp_config__");
    files.delete("__mcp_config__");

    if (mcpConfigJson) {
      const settingsPath = join(projectPath, ".claude", "settings.json");
      let settings: Record<string, unknown> = {};
      const existed = existsSync(settingsPath);

      if (existed) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        } catch {
          // Backup corrupted file
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
      (existed ? updated : created).push(".claude/settings.json");
    }

    // Merge CLAUDE.md (append if exists, don't overwrite user content)
    const claudeMdContent = files.get("CLAUDE.md");
    files.delete("CLAUDE.md");

    if (claudeMdContent) {
      const claudeMdPath = join(projectPath, "CLAUDE.md");
      const existed = existsSync(claudeMdPath);

      if (existed) {
        const existing = readFileSync(claudeMdPath, "utf-8");
        // Replace existing ccDoc section or append
        const marker = "# ccDoc Documentation System";
        if (existing.includes(marker)) {
          // Find the ccDoc section and replace it
          const startIdx = existing.indexOf(marker);
          // Find next top-level heading after ccDoc section
          const afterSection = existing.slice(startIdx + marker.length);
          const nextHeadingMatch = afterSection.match(/\n# (?!#)/);
          const endIdx = nextHeadingMatch
            ? startIdx + marker.length + nextHeadingMatch.index!
            : existing.length;
          const updated_content = existing.slice(0, startIdx) + claudeMdContent.trimEnd() + "\n" + existing.slice(endIdx);
          writeFileSync(claudeMdPath, updated_content, "utf-8");
        } else {
          writeFileSync(claudeMdPath, existing.trimEnd() + "\n\n" + claudeMdContent, "utf-8");
        }
        updated.push("CLAUDE.md");
      } else {
        writeFileSync(claudeMdPath, claudeMdContent, "utf-8");
        created.push("CLAUDE.md");
      }
    }

    // Write all other files
    for (const [relPath, content] of files) {
      const fullPath = join(projectPath, relPath);
      const existed = existsSync(fullPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
      (existed ? updated : created).push(relPath);
    }

    // Also update global ~/.claude.json so VS Code extension picks up the MCP server
    if (mcpConfigJson) {
      this.updateGlobalClaudeConfig(projectPath, JSON.parse(mcpConfigJson));
    }

    // Auto-allow all ccdoc MCP tools
    this.addAutoPermissions(projectPath);

    return { created, updated };
  }

  uninstall(projectPath: string): { removed: string[] } {
    const removed: string[] = [];

    // Remove command files
    const commands = ["tree.md", "search.md", "section.md", "create-doc.md", "import.md", "scaffold.md", "review.md", "summarize.md", "history.md"];
    for (const cmd of commands) {
      const p = join(projectPath, ".claude", "commands", cmd);
      if (existsSync(p)) {
        rmSync(p);
        removed.push(`.claude/commands/${cmd}`);
      }
    }
    // Remove commands dir if empty
    const commandsDir = join(projectPath, ".claude", "commands");
    if (existsSync(commandsDir)) {
      try {
        if (readdirSync(commandsDir).length === 0) rmSync(commandsDir, { recursive: true });
      } catch { /* ignore */ }
    }

    // Remove agent
    const agentPath = join(projectPath, ".claude", "agents", "ccdoc.md");
    if (existsSync(agentPath)) {
      rmSync(agentPath);
      removed.push(".claude/agents/ccdoc.md");
    }
    const agentsDir = join(projectPath, ".claude", "agents");
    if (existsSync(agentsDir)) {
      try {
        if (readdirSync(agentsDir).length === 0) rmSync(agentsDir, { recursive: true });
      } catch { /* ignore */ }
    }

    // Remove ccdoc from settings.json
    const settingsPath = join(projectPath, ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        if (settings.mcpServers && typeof settings.mcpServers === "object" && "ccdoc" in settings.mcpServers) {
          delete settings.mcpServers.ccdoc;
          // If mcpServers is now empty, remove it
          if (Object.keys(settings.mcpServers).length === 0) {
            delete settings.mcpServers;
          }
          // If settings is now empty, delete file
          if (Object.keys(settings).length === 0) {
            rmSync(settingsPath);
          } else {
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
          }
          removed.push(".claude/settings.json (ccdoc removed)");
        }
      } catch {
        console.warn("InstallService.uninstall: failed to parse settings.json");
      }
    }

    // Remove auto-permissions
    this.removeAutoPermissions(projectPath);

    // Remove .claude dir if empty
    const claudeDir = join(projectPath, ".claude");
    if (existsSync(claudeDir)) {
      try {
        if (readdirSync(claudeDir).length === 0) rmSync(claudeDir, { recursive: true });
      } catch { /* ignore */ }
    }

    // Remove ccDoc section from CLAUDE.md
    const claudeMdPath = join(projectPath, "CLAUDE.md");
    if (existsSync(claudeMdPath)) {
      const content = readFileSync(claudeMdPath, "utf-8");
      const marker = "# ccDoc Documentation System";
      if (content.includes(marker)) {
        const startIdx = content.indexOf(marker);
        const afterSection = content.slice(startIdx + marker.length);
        const nextHeadingMatch = afterSection.match(/\n# (?!#)/);
        const endIdx = nextHeadingMatch
          ? startIdx + marker.length + nextHeadingMatch.index!
          : content.length;
        const result = (content.slice(0, startIdx) + content.slice(endIdx)).trim();
        if (result.length === 0) {
          rmSync(claudeMdPath);
        } else {
          writeFileSync(claudeMdPath, result + "\n", "utf-8");
        }
        removed.push("CLAUDE.md (ccDoc section removed)");
      }
    }

    // Remove ccdoc from global ~/.claude.json
    this.removeFromGlobalClaudeConfig(projectPath, removed);

    return { removed };
  }

  addAutoPermissions(projectPath: string): void {
    const settingsPath = join(projectPath, ".claude", "settings.json");
    let settings: Record<string, unknown> = {};

    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      } catch {
        console.warn("InstallService.addAutoPermissions: failed to parse settings.json");
        return;
      }
    }

    if (!settings.permissions || typeof settings.permissions !== "object") {
      settings.permissions = {};
    }
    const permissions = settings.permissions as Record<string, unknown>;

    if (!Array.isArray(permissions.allow)) {
      permissions.allow = [];
    }
    const allow = permissions.allow as string[];

    if (!allow.includes("mcp__ccdoc__*")) {
      allow.push("mcp__ccdoc__*");
    }

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }

  removeAutoPermissions(projectPath: string): void {
    const settingsPath = join(projectPath, ".claude", "settings.json");
    if (!existsSync(settingsPath)) return;

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      console.warn("InstallService.removeAutoPermissions: failed to parse settings.json");
      return;
    }

    const permissions = settings.permissions as Record<string, unknown> | undefined;
    if (!permissions || !Array.isArray(permissions.allow)) return;

    permissions.allow = (permissions.allow as string[]).filter((e) => e !== "mcp__ccdoc__*");

    if ((permissions.allow as string[]).length === 0) {
      delete permissions.allow;
    }
    if (Object.keys(permissions).length === 0) {
      delete settings.permissions;
    }

    if (Object.keys(settings).length === 0) {
      rmSync(settingsPath);
    } else {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
  }

  hasAutoPermissions(projectPath: string): boolean {
    const settingsPath = join(projectPath, ".claude", "settings.json");
    if (!existsSync(settingsPath)) return false;

    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const allow = settings?.permissions?.allow;
      return Array.isArray(allow) && allow.includes("mcp__ccdoc__*");
    } catch {
      return false;
    }
  }

  private removeFromGlobalClaudeConfig(projectPath: string, removed: string[]): void {
    const globalConfigPath = join(homedir(), ".claude.json");
    if (!existsSync(globalConfigPath)) return;

    try {
      const config = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
      const projects = config.projects as Record<string, Record<string, unknown>> | undefined;
      if (!projects) return;

      const normalizedPath = projectPath.replace(/\\/g, "/").toLowerCase();
      let changed = false;

      for (const key of Object.keys(projects)) {
        if (key.replace(/\\/g, "/").toLowerCase() === normalizedPath) {
          const mcpServers = projects[key].mcpServers as Record<string, unknown> | undefined;
          if (mcpServers && "ccdoc" in mcpServers) {
            delete mcpServers.ccdoc;
            if (Object.keys(mcpServers).length === 0) delete projects[key].mcpServers;
            if (Object.keys(projects[key]).length === 0) delete projects[key];
            changed = true;
          }
        }
      }

      if (changed) {
        writeFileSync(globalConfigPath, JSON.stringify(config, null, 2), "utf-8");
        removed.push("~/.claude.json (ccdoc removed)");
      }
    } catch {
      console.warn("InstallService.uninstall: failed to update global ~/.claude.json");
    }
  }

  private updateGlobalClaudeConfig(projectPath: string, mcpConfig: Record<string, unknown>): void {
    const globalConfigPath = join(homedir(), ".claude.json");
    let config: Record<string, unknown> = {};

    if (existsSync(globalConfigPath)) {
      try {
        config = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
      } catch {
        return; // Don't break on corrupted global config
      }
    }

    const projects = (config.projects || {}) as Record<string, Record<string, unknown>>;
    const normalizedPath = projectPath.replace(/\\/g, "/");

    // Update all matching project entries (handles D:/ vs d:/ case differences)
    let found = false;
    for (const key of Object.keys(projects)) {
      if (key.replace(/\\/g, "/").toLowerCase() === normalizedPath.toLowerCase()) {
        if (!projects[key].mcpServers || typeof projects[key].mcpServers !== "object") {
          projects[key].mcpServers = {};
        }
        (projects[key].mcpServers as Record<string, unknown>).ccdoc = mcpConfig;
        found = true;
      }
    }

    // If no matching entry exists, create one
    if (!found) {
      projects[normalizedPath] = {
        mcpServers: { ccdoc: mcpConfig },
      };
    }

    config.projects = projects;
    writeFileSync(globalConfigPath, JSON.stringify(config, null, 2), "utf-8");
  }
}
