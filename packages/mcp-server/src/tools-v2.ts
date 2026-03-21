import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getProjectServices,
  getEmbeddingModel,
  projectsService,
  errorResult,
} from "./shared.js";

interface TreeNode {
  id: string;
  title: string;
  type: string;
  children: TreeNode[];
  [key: string]: unknown;
}

interface CompactNode {
  id: string;
  title: string;
  type: string;
  summary?: string;
  children_count?: number;
  children?: CompactNode[];
}

function compactTree(nodes: TreeNode[], depth = 0, maxDepth = 2): CompactNode[] {
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const willExpand = depth < maxDepth && hasChildren;

    const compact: CompactNode = {
      id: node.id,
      title: node.title,
      type: node.type,
    };
    if (node.type === "file" && (node as any).summary) {
      compact.summary = (node as any).summary;
    }
    if (willExpand) {
      compact.children = compactTree(node.children, depth + 1, maxDepth);
    } else if (hasChildren) {
      compact.children_count = node.children.length;
    }
    return compact;
  });
}

export function registerV2Tools(server: McpServer): void {
  // list_projects is always needed
  server.tool(
    "list_projects",
    "List all registered projects with their tokens and metadata",
    {},
    async () => {
      try {
        const projects = await projectsService.list();
        return {
          content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "overview",
    "Get project passport (name, stack, conventions) and compact documentation tree (depth 2, no content). Call this first to orient yourself in the project.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
    },
    async ({ project_token }) => {
      try {
        const { sections, passport } = await getProjectServices(project_token);
        const passportData = await passport.getAll();
        const tree = await sections.getTree();
        const compact = compactTree(tree as unknown as TreeNode[]);

        const result = {
          passport: Object.keys(passportData).length > 0 ? passportData : null,
          tree: compact,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "find",
    "Search project documentation. Returns short snippets with breadcrumb paths — not full content. Use 'read' to get full text when a snippet is not enough.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      query: z.string().describe("Search query (natural language or keywords)"),
      max_results: z.number().int().min(1).max(20).default(5).optional()
        .describe("Max results to return (default 5)"),
    },
    async ({ project_token, query, max_results }) => {
      try {
        const { sections, fts, index, find, embeddingRepo } = await getProjectServices(project_token);

        // Auto-index if FTS is empty, or if embedding model is now available but embeddings aren't generated yet
        const ftsEmpty = !(await fts.isIndexed());
        const embeddingModelReady = getEmbeddingModel()?.isAvailable() ?? false;
        const embeddingEmpty = embeddingModelReady && (await embeddingRepo.count()) === 0;
        if (ftsEmpty || embeddingEmpty) {
          await index.reindexAll();
        }

        const limit = max_results ?? 5;
        const results = await find.search(query, limit);

        if (results.length === 0) {
          return { content: [{ type: "text", text: `No results for "${query}".` }] };
        }

        const entries: object[] = [];
        for (const r of results) {
          // For embedding-only results, fetch title from sections
          let title = r.title;
          if (!title) {
            const sec = await sections.getById(r.id);
            if (!sec) continue;
            title = sec.title;
          }

          const chain = await sections.getParentChain(r.id);
          const path = chain.map((c) => c.title).join(" / ");
          const location = path ? `${path} / ${title}` : title;

          // Get children ids
          const children = await sections.getSectionChildren(r.id);
          const childrenIds = children.map((c) => c.id);

          // Clean snippet from HTML tags, limit to 200 chars
          let snippet = r.snippet.replace(/<\/?mark>/g, "");
          if (snippet.length > 200) snippet = snippet.slice(0, 200) + "…";

          entries.push({
            id: r.id,
            path: location,
            snippet: snippet || undefined,
            score: Math.round(r.score * 100) / 100,
            children: childrenIds.length > 0 ? childrenIds : undefined,
          });
        }

        return {
          content: [{ type: "text", text: JSON.stringify(entries) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "read",
    "Get full content of a section by its ID. Use after 'find' when you need the complete text.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      section_id: z.string().uuid().describe("Section UUID from 'find' or 'overview'"),
    },
    async ({ project_token, section_id }) => {
      try {
        const { sections } = await getProjectServices(project_token);
        const section = await sections.getById(section_id);
        if (!section) {
          return { content: [{ type: "text", text: "Section not found" }] };
        }

        const chain = await sections.getParentChain(section_id);
        const path = chain.map((c) => c.title).join(" / ");
        const plainText = await sections.getContent(section_id, "plain");
        const children = await sections.getSectionChildren(section_id);

        const result: Record<string, unknown> = {
          title: section.title,
          path: path || null,
          content: plainText,
        };

        if (children.length > 0) {
          result.children = children.map((c) => ({
            id: c.id,
            title: c.title,
            type: c.type,
          }));
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_latest_idea",
    "Get the most recent idea section with its implementation plan (if exists). Use this when the user asks to implement the latest idea.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
    },
    async ({ project_token }) => {
      try {
        const { sections } = await getProjectServices(project_token);
        const idea = await sections.getLatestByType("idea");
        if (!idea) {
          return { content: [{ type: "text", text: "No ideas found in this project." }] };
        }

        const ideaContent = await sections.getContent(idea.id, "plain");
        const children = await sections.getSectionChildren(idea.id);
        const planChild = children.find((c) => c.type === "section");

        const result: Record<string, unknown> = {
          idea: {
            id: idea.id,
            title: idea.title,
            content: ideaContent,
          },
          plan: null,
        };

        if (planChild) {
          const planContent = await sections.getContent(planChild.id, "plain");
          result.plan = {
            id: planChild.id,
            title: planChild.title,
            content: planContent,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );
}
