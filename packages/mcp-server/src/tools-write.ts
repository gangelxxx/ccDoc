import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
import { ExportService, ImportService, EXPORT_DOCS_DIR, splitMarkdownByHeadings } from "@ccdoc/core";
import type { OutputFormat } from "@ccdoc/core";
import {
  allowWrite,
  getProjectServices,
  projectsService,
  errorResult,
} from "./shared.js";

export function registerWriteTools(server: McpServer): void {
  if (!allowWrite) return;

  server.tool(
    "create_section",
    "Create a new documentation section. IMPORTANT: always provide meaningful, detailed content for file/section/idea types — never create empty documents. For 'file' type with content, the system automatically splits ## headings into child sections and ### into nested sub-sections. Hierarchy: root → only folder; folder → folder/file/idea/todo/kanban/excalidraw; file → section; section → section.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      parent_id: z.string().uuid().nullable().describe("Parent section UUID, or null for root level"),
      title: z.string().describe("Section title"),
      content: z.string().describe("Markdown content for the section body (REQUIRED and must be non-empty for file/section/idea types)"),
      type: z.enum(["folder", "file", "section", "idea", "excalidraw", "kanban", "todo"]).describe("Section type: folder (container), file (document with sub-sections), section (sub-section of a file), idea, excalidraw, kanban, todo"),
    },
    async ({ project_token, parent_id, title, content, type }) => {
      try {
        const { sections, index } = await getProjectServices(project_token);

        // For 'file' with content: create file, then split markdown into nested child sections
        if (type === "file" && content) {
          const file = await sections.create({ parentId: parent_id, title, type: "file" });
          const { sections: parts } = splitMarkdownByHeadings(content);
          let totalCreated = 0;
          if (parts.length > 0) {
            for (const part of parts) {
              const sec = await sections.create({ parentId: file.id, title: part.title, type: "section", content: part.content || undefined });
              totalCreated++;
              for (const child of part.children) {
                await sections.create({ parentId: sec.id, title: child.title, type: "section", content: child.content });
                totalCreated++;
              }
            }
          } else {
            // No headings found — create single child section with all content
            await sections.create({ parentId: file.id, title: "Содержание", type: "section", content });
            totalCreated = 1;
          }
          await index.reindexAll();
          return {
            content: [{ type: "text", text: JSON.stringify({ id: file.id, title: file.title, sections_created: totalCreated }) }],
          };
        }

        const section = await sections.create({ parentId: parent_id, title, content, type });
        await index.indexSection(section);
        return {
          content: [{ type: "text", text: JSON.stringify({ id: section.id, title: section.title }) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_section",
    "Update section title and/or content. Omit title or content to keep the current value.",
    {
      section_id: z.string().uuid().describe("Section UUID to update"),
      project_token: z.string().uuid().describe("Project UUID token"),
      title: z.string().optional().describe("New title (keeps current if omitted)"),
      content: z.string().optional().describe("New markdown content (keeps current if omitted)"),
    },
    async ({ section_id, project_token, title, content }) => {
      try {
        const { sections, index } = await getProjectServices(project_token);

        const current = await sections.getById(section_id);
        if (!current) {
          return errorResult(new Error(`Section ${section_id} not found`));
        }
        const finalTitle = title ?? current.title;
        const titleChanged = title !== undefined && current.title !== title;

        if (content !== undefined) {
          // Content provided — go through format conversion (markdown → internal)
          await sections.update(section_id, finalTitle, content);
        } else if (titleChanged) {
          // Title-only update — use raw content to avoid lossy markdown round-trip
          // (kanban, idea, excalidraw store JSON that would be corrupted by markdown conversion)
          await sections.updateRaw(section_id, finalTitle, current.content);
        }
        const updated = await sections.getById(section_id);
        if (updated) {
          await index.indexSection(updated);
          // If title changed, descendants' breadcrumbs need updating
          if (titleChanged) await index.reindexDescendants(section_id);
        }
        return {
          content: [{ type: "text", text: "Section updated" }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "delete_section",
    "Soft-delete a section (can be restored later)",
    {
      section_id: z.string().uuid().describe("Section UUID to delete"),
      project_token: z.string().uuid().describe("Project UUID token"),
    },
    async ({ section_id, project_token }) => {
      try {
        const { sections, index } = await getProjectServices(project_token);
        // Collect descendant IDs before soft-delete (cascade will mark them too)
        const idsToRemove = [section_id];
        async function collectDescendants(parentId: string) {
          const children = await sections.getSectionChildren(parentId);
          for (const child of children) {
            idsToRemove.push(child.id);
            await collectDescendants(child.id);
          }
        }
        await collectDescendants(section_id);
        await sections.softDelete(section_id);
        for (const id of idsToRemove) {
          await index.removeSection(id);
        }
        return {
          content: [{ type: "text", text: "Section deleted" }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "move_section",
    "Move a section to a new parent and/or position in the tree",
    {
      section_id: z.string().uuid().describe("Section UUID to move"),
      project_token: z.string().uuid().describe("Project UUID token"),
      new_parent_id: z.string().uuid().nullable().describe("New parent section UUID, or null for root level"),
      after_id: z.string().uuid().nullable().describe("Place after this section UUID, or null for first position"),
    },
    async ({ section_id, project_token, new_parent_id, after_id }) => {
      try {
        const { sections, index } = await getProjectServices(project_token);
        await sections.move(section_id, new_parent_id, after_id);
        // Breadcrumbs changed for moved section and all descendants
        const moved = await sections.getById(section_id);
        if (moved) await index.indexSection(moved);
        await index.reindexDescendants(section_id);
        return {
          content: [{ type: "text", text: "Section moved" }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  // --- New write tools ---

  server.tool(
    "export_project",
    "Export all project sections to markdown files on disk",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      output_dir: z.string().optional().describe("Output directory path (defaults to project docs/ directory)"),
    },
    async ({ project_token, output_dir }) => {
      try {
        const { db, sections } = await getProjectServices(project_token);
        const project = await projectsService.getByToken(project_token);
        if (!project) return errorResult(new Error("Project not found"));

        const exportService = new ExportService(db);
        const allSections = await sections.listAll();
        const dir = output_dir ?? join(project.path, EXPORT_DOCS_DIR);
        await exportService.writeToDir(allSections, dir);

        return {
          content: [{ type: "text", text: `Exported ${allSections.length} sections to ${dir}` }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "import_markdown",
    "Import markdown content into a project folder, automatically splitting by headings",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      folder_id: z.string().uuid().describe("Target folder UUID to import into"),
      file_name: z.string().describe("Name for the imported file"),
      markdown: z.string().describe("Markdown content to import"),
    },
    async ({ project_token, folder_id, file_name, markdown }) => {
      try {
        const { sections, index } = await getProjectServices(project_token);
        const importService = new ImportService(sections);
        const fileId = await importService.importMarkdown(folder_id, file_name, markdown);
        await index.reindexAll();
        return {
          content: [{ type: "text", text: JSON.stringify({ file_id: fileId, message: "Import complete" }) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "bulk_create_sections",
    "Create multiple sections at once — preferred over multiple create_section calls. IMPORTANT: always provide meaningful, detailed content for file/section/idea types — never create empty documents. For 'file' type with content, the system automatically splits ## headings into child sections and ### into nested sub-sections. Use '$N' as parent_id to reference the Nth section from this batch (0-indexed). Hierarchy: root → only folder; folder → folder/file/idea/todo/kanban/excalidraw; file → section; section → section.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      sections: z.array(z.object({
        parent_id: z.string().nullable().describe("Parent UUID, null for root, or '$N' to reference Nth section in this batch"),
        title: z.string().describe("Section title"),
        content: z.string().optional().describe("Markdown content (REQUIRED for file, section, idea types)"),
        type: z.enum(["folder", "file", "section", "idea", "excalidraw", "kanban", "todo"]).describe("Section type"),
      }).refine(
        (s) => s.type === "folder" || (s.content && s.content.trim().length > 0),
        { message: "content is required and must be non-empty for non-folder types" }
      )).describe("Array of sections to create, processed in order"),
    },
    async ({ project_token, sections: sectionDefs }) => {
      try {
        const { sections, index } = await getProjectServices(project_token);
        const createdIds: string[] = [];

        for (const def of sectionDefs) {
          let parentId = def.parent_id;
          if (parentId && parentId.startsWith("$")) {
            const idx = parseInt(parentId.slice(1), 10);
            if (isNaN(idx) || idx < 0 || idx >= createdIds.length) {
              return errorResult(new Error(`Invalid batch reference ${parentId}: only ${createdIds.length} sections created so far`));
            }
            parentId = createdIds[idx];
          }

          // For 'file' with content: split markdown into child sections
          if (def.type === "file" && def.content) {
            const file = await sections.create({ parentId, title: def.title, type: "file" });
            const { sections: parts } = splitMarkdownByHeadings(def.content);
            if (parts.length > 0) {
              for (const part of parts) {
                const sec = await sections.create({ parentId: file.id, title: part.title, type: "section", content: part.content || undefined });
                for (const child of part.children) {
                  await sections.create({ parentId: sec.id, title: child.title, type: "section", content: child.content });
                }
              }
            } else {
              await sections.create({ parentId: file.id, title: "Содержание", type: "section", content: def.content });
            }
            createdIds.push(file.id);
          } else {
            const created = await sections.create({
              parentId,
              title: def.title,
              content: def.content,
              type: def.type,
            });
            createdIds.push(created.id);
          }
        }

        await index.reindexAll();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ created: createdIds.length, ids: createdIds }),
          }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_icon",
    "Set or remove an emoji icon for a section. Use icons to visually distinguish sections in the tree (e.g. folders, files, ideas). Pass null to remove.",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      section_id: z.string().uuid().describe("Section UUID"),
      icon: z.string().nullable().describe("Single emoji character (e.g. '📝', '🏗️', '📊') or null to remove"),
    },
    async ({ project_token, section_id, icon }) => {
      try {
        const { sections } = await getProjectServices(project_token);
        await sections.updateIcon(section_id, icon);
        return {
          content: [{ type: "text", text: "Icon updated" }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "commit_history",
    "Create a version history snapshot (git commit) of the current project state",
    {
      project_token: z.string().uuid().describe("Project UUID token"),
      message: z.string().describe("Commit message describing the changes"),
    },
    async ({ project_token, message }) => {
      try {
        const { sections, history } = await getProjectServices(project_token);
        const allSections = await sections.listAll();
        const oid = await history.commit(allSections, message);
        return {
          content: [{ type: "text", text: JSON.stringify({ commit_oid: oid, message }) }],
        };
      } catch (e: unknown) {
        return errorResult(e);
      }
    }
  );
}
