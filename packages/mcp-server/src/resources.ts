import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getProjectServices,
  projectsService,
  formatError,
} from "./shared.js";

export function registerResources(server: McpServer): void {
  // Static resource: list of all projects
  server.resource(
    "projects",
    "ccdoc://projects",
    { description: "List of all registered ccDoc projects", mimeType: "application/json" },
    async (uri) => {
      try {
        const projects = await projectsService.list();
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(projects, null, 2),
          }],
        };
      } catch (e) {
        return { contents: [{ uri: uri.href, text: `Error: ${formatError(e)}` }] };
      }
    }
  );

  // Template resource: project section tree
  server.resource(
    "project-tree",
    new ResourceTemplate("ccdoc://project/{token}/tree", {
      list: async () => {
        const projects = await projectsService.list();
        return {
          resources: projects.map(p => ({
            uri: `ccdoc://project/${p.token}/tree`,
            name: `${p.name} — Tree`,
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        token: async (value) => {
          const projects = await projectsService.list();
          return projects
            .filter(p => p.token.startsWith(value) || p.name.toLowerCase().includes(value.toLowerCase()))
            .map(p => p.token);
        },
      },
    }),
    { description: "Section tree for a ccDoc project", mimeType: "application/json" },
    async (uri, variables) => {
      try {
        const token = variables.token as string;
        const { sections } = await getProjectServices(token);
        const tree = await sections.getTree();
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(tree, null, 2),
          }],
        };
      } catch (e) {
        return { contents: [{ uri: uri.href, text: `Error: ${formatError(e)}` }] };
      }
    }
  );

  // Template resource: individual section content
  server.resource(
    "section-content",
    new ResourceTemplate("ccdoc://project/{token}/section/{id}", {
      list: undefined,
      complete: {
        token: async (value) => {
          const projects = await projectsService.list();
          return projects
            .filter(p => p.token.startsWith(value) || p.name.toLowerCase().includes(value.toLowerCase()))
            .map(p => p.token);
        },
      },
    }),
    { description: "Section content from a ccDoc project (markdown)", mimeType: "text/markdown" },
    async (uri, variables) => {
      try {
        const token = variables.token as string;
        const id = variables.id as string;
        const { sections } = await getProjectServices(token);
        const content = await sections.getContent(id, "markdown");
        const section = await sections.getById(id);
        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: section ? `# ${section.title}\n\n${content}` : content,
          }],
        };
      } catch (e) {
        return { contents: [{ uri: uri.href, text: `Error: ${formatError(e)}` }] };
      }
    }
  );
}
