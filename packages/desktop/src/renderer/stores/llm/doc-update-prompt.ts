/**
 * Builds the user prompt and doc tree summary for the "Update Documentation" feature.
 */

import type { TreeNode } from "../types.js";

const TYPE_ICONS: Record<string, string> = {
  folder: "\u{1F4C1}",
  file: "\u{1F4C4}",
  section: "\u{1F4CE}",
  idea: "\u{1F4A1}",
  todo: "\u2705",
  kanban: "\u{1F4CB}",
  drawing: "\u{1F4CA}",
};

function renderTree(nodes: TreeNode[], depth: number): string {
  return nodes
    .map((node) => {
      const indent = "  ".repeat(depth);
      const icon = node.icon || TYPE_ICONS[node.type] || "\u{1F4C4}";
      const children =
        node.children.length > 0
          ? "\n" + renderTree(node.children, depth + 1)
          : "";
      return `${indent}${icon} ${node.title} [${node.id.slice(0, 8)}]${children}`;
    })
    .join("\n");
}

export function buildDocTreeSummary(tree: TreeNode[]): string {
  if (tree.length === 0) return "(empty documentation)";
  return renderTree(tree, 0);
}

export function buildDocUpdatePrompt(docTree: string): string {
  return `## Task: Update project documentation

Analyze the current project documentation and source code, find discrepancies, and update the documentation.

### Current documentation structure:
${docTree}

### Instructions:
1. **Read key documentation sections** via \`gt\` (structure) and \`read\` (content)
2. **Study the source code** via \`get_project_tree\`, \`get_file_outlines\`, \`find_symbols\`
3. **Find discrepancies**:
   - New functions/classes/modules not described in the documentation
   - Deleted or renamed entities still mentioned in the documentation
   - Changed APIs (new parameters, modified return types)
   - Outdated code examples
4. **Update sections** via \`update_section\` — only those with actual discrepancies
5. **Create new sections** via \`create_section\` for new functionality if needed

### Important:
- Do NOT rewrite the entire documentation — update only the outdated parts
- Preserve the style and structure of the existing documentation
- When in doubt — ask the user via ask_user
- Start with a tree overview, then read sections by priority
- Output a brief report at the end: what was updated, what was added, what needs manual review`;
}

export function buildLinkedDocGenPrompt(projectName: string, sourcePath: string): string {
  return `## Task: Generate documentation for project "${projectName}"

Project is located at: ${sourcePath}

### Instructions:
1. **Study the project structure** via \`get_project_tree\` — understand what files and folders exist
2. **Study key files** via \`get_file_outlines\` and \`read_project_file\` — understand the stack, architecture, main components
3. **Create the documentation structure**:
   - Create a folder with the project name
   - Inside, create files by section: Overview, Architecture, API, Configuration, etc.
   - Fill each section with real content based on the source code
4. **Write content** for each section — not stubs, but real descriptions:
   - Overview: what the project does, tech stack, how to run
   - Architecture: project structure, key modules, relationships between them
   - API: main functions, classes, their parameters and return types
   - Configuration: key config files and what they configure

### Important:
- Write documentation in the user's language
- Use \`create_section\` with content in markdown format
- Use \`bulk_create_sections\` to create multiple sections at once
- Start with \`get_project_tree\` to understand the structure, then read key files
- Output a brief report at the end: what was created, how many sections`;
}

export function buildLinkedDocUpdatePrompt(projectName: string, sourcePath: string, docTree: string): string {
  return `## Task: Update documentation for project "${projectName}"

Project is located at: ${sourcePath}

### Current documentation structure:
${docTree}

### Instructions:
1. **Read existing documentation** via \`gt\` and \`read\`
2. **Study the source code** via \`get_project_tree\`, \`get_file_outlines\`, \`read_project_file\`
3. **Find discrepancies** between code and documentation
4. **Update** outdated sections via \`update_section\`
5. **Add** new sections for functionality not described in the documentation

### Important:
- Update only what has actually changed
- Preserve the style of the existing documentation
- Output a brief report at the end`;
}
