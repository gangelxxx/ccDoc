import type { Client } from "@libsql/client";
import type { Workspace, LinkedProject, DocStatus } from "../types.js";

export class WorkspaceRepo {
  constructor(private db: Client) {}

  // --- Workspace CRUD ---

  async getById(id: string): Promise<Workspace | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM workspaces WHERE id = ?",
      args: [id],
    });
    return (result.rows[0] as unknown as Workspace) ?? null;
  }

  async getByProjectToken(token: string): Promise<Workspace | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM workspaces WHERE root_project_token = ?",
      args: [token],
    });
    return (result.rows[0] as unknown as Workspace) ?? null;
  }

  async create(workspace: Omit<Workspace, "created_at" | "updated_at">): Promise<void> {
    await this.db.execute({
      sql: "INSERT INTO workspaces (id, name, root_project_token) VALUES (?, ?, ?)",
      args: [workspace.id, workspace.name, workspace.root_project_token],
    });
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE workspaces SET name = ?, updated_at = datetime('now') WHERE id = ?",
      args: [name, id],
    });
  }

  async updateIcon(id: string, icon: string | null): Promise<void> {
    await this.db.execute({
      sql: "UPDATE workspaces SET icon = ?, updated_at = datetime('now') WHERE id = ?",
      args: [icon, id],
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM workspaces WHERE id = ?",
      args: [id],
    });
  }

  // --- LinkedProject CRUD ---

  async listLinkedProjects(workspaceId: string): Promise<LinkedProject[]> {
    const result = await this.db.execute({
      sql: "SELECT * FROM linked_projects WHERE workspace_id = ? ORDER BY sort_order, added_at",
      args: [workspaceId],
    });
    return result.rows.map((r) => ({
      ...(r as unknown as LinkedProject),
      has_ccdoc: Boolean((r as any).has_ccdoc),
    }));
  }

  async getLinkedProject(id: string): Promise<LinkedProject | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM linked_projects WHERE id = ?",
      args: [id],
    });
    if (!result.rows[0]) return null;
    const r = result.rows[0] as any;
    return { ...r, has_ccdoc: Boolean(r.has_ccdoc) } as LinkedProject;
  }

  async addLinkedProject(lp: Omit<LinkedProject, "added_at">): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO linked_projects (id, workspace_id, project_token, source_path, alias, icon, has_ccdoc, doc_status, link_type, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        lp.id, lp.workspace_id, lp.project_token, lp.source_path,
        lp.alias, lp.icon, lp.has_ccdoc ? 1 : 0, lp.doc_status, lp.link_type, lp.sort_order,
      ],
    });
  }

  async removeLinkedProject(id: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM linked_projects WHERE id = ?",
      args: [id],
    });
  }

  async updateLinkedProject(
    id: string,
    fields: {
      alias?: string;
      icon?: string | null;
      sort_order?: number;
      doc_status?: DocStatus;
      has_ccdoc?: boolean;
      project_token?: string;
    },
  ): Promise<void> {
    const sets: string[] = [];
    const args: any[] = [];
    if (fields.alias !== undefined) { sets.push("alias = ?"); args.push(fields.alias); }
    if (fields.icon !== undefined) { sets.push("icon = ?"); args.push(fields.icon); }
    if (fields.sort_order !== undefined) { sets.push("sort_order = ?"); args.push(fields.sort_order); }
    if (fields.doc_status !== undefined) { sets.push("doc_status = ?"); args.push(fields.doc_status); }
    if (fields.has_ccdoc !== undefined) { sets.push("has_ccdoc = ?"); args.push(fields.has_ccdoc ? 1 : 0); }
    if (fields.project_token !== undefined) { sets.push("project_token = ?"); args.push(fields.project_token); }
    if (sets.length === 0) return;
    args.push(id);
    await this.db.execute({
      sql: `UPDATE linked_projects SET ${sets.join(", ")} WHERE id = ?`,
      args,
    });
  }

  async linkedProjectExists(workspaceId: string, sourcePath: string): Promise<boolean> {
    const result = await this.db.execute({
      sql: "SELECT 1 FROM linked_projects WHERE workspace_id = ? AND source_path = ? LIMIT 1",
      args: [workspaceId, sourcePath],
    });
    return result.rows.length > 0;
  }
}
