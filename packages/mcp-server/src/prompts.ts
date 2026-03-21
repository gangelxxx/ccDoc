import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getProjectServices,
  projectsService,
} from "./shared.js";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "create-document",
    "Guide the creation of a structured document in a ccDoc project",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      topic: z.string().describe("Topic or subject the document should cover"),
      document_type: z.string().default("guide").describe("Type: guide, spec, readme, or notes"),
    },
    async ({ project_token, topic, document_type }) => {
      const { sections } = await getProjectServices(project_token);
      const tree = await sections.getTree();
      const project = await projectsService.getByToken(project_token);
      const projectName = project?.name ?? "Unknown";

      return {
        description: `Create a ${document_type} about "${topic}" in project "${projectName}"`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `You are helping create a new ${document_type} document in the ccDoc project "${projectName}".

Topic: ${topic}

Current project structure:
${JSON.stringify(tree, null, 2)}

Please:
1. Suggest which folder this document belongs in (or suggest creating a new folder)
2. Create a well-structured document with appropriate sections
3. Use the create_section tool to create the document with type "file" inside the chosen folder
4. Then create sub-sections of type "section" for each major part

The hierarchy rules are:
- Root level can only have folders
- Folders contain: folders, files, ideas, todos, kanban, excalidraw
- Files contain: sections
- Sections contain: sections (for nesting)

Provide the content in markdown format.`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "review-structure",
    "Analyze a ccDoc project structure and suggest organizational improvements",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
    },
    async ({ project_token }) => {
      const { sections } = await getProjectServices(project_token);
      const tree = await sections.getTree();
      const allSections = await sections.listAll();
      const project = await projectsService.getByToken(project_token);
      const projectName = project?.name ?? "Unknown";

      const stats = {
        total: allSections.length,
        folders: allSections.filter(s => s.type === "folder").length,
        files: allSections.filter(s => s.type === "file").length,
        sections: allSections.filter(s => s.type === "section").length,
        ideas: allSections.filter(s => s.type === "idea").length,
        todos: allSections.filter(s => s.type === "todo").length,
        kanban: allSections.filter(s => s.type === "kanban").length,
        excalidraw: allSections.filter(s => s.type === "excalidraw").length,
      };

      return {
        description: `Review structure of project "${projectName}"`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Review the structure of the ccDoc project "${projectName}" and suggest improvements.

Statistics:
${JSON.stringify(stats, null, 2)}

Full tree structure:
${JSON.stringify(tree, null, 2)}

Please analyze:
1. Is the folder hierarchy logical and well-organized?
2. Are there any orphaned or misplaced sections?
3. Are there folders with too many or too few items?
4. Could any flat structures benefit from grouping?
5. Are naming conventions consistent?
6. Suggest concrete reorganization steps using move_section and create_section tools.`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "summarize",
    "Summarize a specific section or the entire ccDoc project",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      section_id: z.string().uuid().optional().describe("Section UUID to summarize (omit for entire project)"),
    },
    async ({ project_token, section_id }) => {
      const { sections } = await getProjectServices(project_token);
      const project = await projectsService.getByToken(project_token);
      const projectName = project?.name ?? "Unknown";

      let contextText: string;
      let targetDescription: string;

      if (section_id) {
        const content = await sections.getContent(section_id, "markdown");
        const section = await sections.getById(section_id);
        targetDescription = `section "${section?.title ?? section_id}"`;
        contextText = `# ${section?.title ?? "Section"}\n\n${content}`;
      } else {
        const allSections = await sections.listAll();
        const contentParts: string[] = [];
        for (const s of allSections.slice(0, 50)) {
          try {
            const content = await sections.getContent(s.id, "plain");
            contentParts.push(`## ${s.title} (${s.type})\n${content}\n`);
          } catch { /* skip unreadable */ }
        }
        targetDescription = `project "${projectName}"`;
        contextText = contentParts.join("\n---\n\n");
        if (allSections.length > 50) {
          contextText += `\n\n... and ${allSections.length - 50} more sections.`;
        }
      }

      return {
        description: `Summarize ${targetDescription}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please provide a comprehensive summary of ${targetDescription} from the ccDoc project "${projectName}".

Content:
${contextText}

Produce:
1. A brief executive summary (2-3 sentences)
2. Key topics covered
3. Important details or decisions documented
4. Any gaps or areas that could use more documentation`,
            },
          },
        ],
      };
    }
  );
}
