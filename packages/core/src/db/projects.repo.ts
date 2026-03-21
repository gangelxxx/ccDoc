import type { Client } from "@libsql/client";
import type { Project } from "../types.js";

export class ProjectsRepo {
  constructor(private db: Client) {}

  async list(): Promise<Project[]> {
    const result = await this.db.execute("SELECT * FROM projects ORDER BY updated_at DESC");
    return result.rows as unknown as Project[];
  }

  async getByToken(token: string): Promise<Project | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM projects WHERE token = ?",
      args: [token],
    });
    return (result.rows[0] as unknown as Project) ?? null;
  }

  async create(project: Omit<Project, "added_at" | "updated_at">): Promise<void> {
    await this.db.execute({
      sql: "INSERT INTO projects (token, name, path) VALUES (?, ?, ?)",
      args: [project.token, project.name, project.path],
    });
  }

  async updatePath(token: string, path: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE projects SET path = ?, updated_at = datetime('now') WHERE token = ?",
      args: [path, token],
    });
  }

  async updateName(token: string, name: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE projects SET name = ?, updated_at = datetime('now') WHERE token = ?",
      args: [name, token],
    });
  }

  async touch(token: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE projects SET updated_at = datetime('now') WHERE token = ?",
      args: [token],
    });
  }

  async remove(token: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM projects WHERE token = ?",
      args: [token],
    });
  }
}
