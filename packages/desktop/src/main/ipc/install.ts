import { app, ipcMain } from "electron";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { InstallService } from "@ccdoc/core";
import { getProjectsService } from "../services";
import { getMainWindow } from "../window";

export function registerInstallIpc(): void {
  // Install Claude Code plugin
  ipcMain.handle("install:claude-plugin", async (_e, token: string) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");

    const send = (data: Record<string, unknown>) => getMainWindow()?.webContents.send("install:progress", data);

    send({ step: "project", status: "done", detail: project.path });

    // Resolve MCP server path
    const mcpServerPath = resolve(join(app.getAppPath(), "../mcp-server/dist/index.js")).replace(/\\/g, "/");
    if (!existsSync(mcpServerPath)) {
      send({ step: "mcp", status: "error", detail: mcpServerPath });
      throw new Error(`MCP server not found at ${mcpServerPath}. Run pnpm build:mcp first.`);
    }
    send({ step: "mcp", status: "done", detail: mcpServerPath });

    send({ step: "install", status: "running" });
    const installService = new InstallService();
    const result = installService.install(project.path, token, mcpServerPath);
    send({ step: "install", status: "done", created: result.created, updated: result.updated });

    return result;
  });

  // Uninstall Claude Code plugin
  ipcMain.handle("install:uninstall-plugin", async (_e, token: string) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");

    const send = (data: Record<string, unknown>) => getMainWindow()?.webContents.send("install:progress", data);

    send({ step: "project", status: "done", detail: project.path });
    send({ step: "uninstall", status: "running" });
    const installService = new InstallService();
    const result = installService.uninstall(project.path);
    send({ step: "uninstall", status: "done", removed: result.removed });

    return result;
  });

}
