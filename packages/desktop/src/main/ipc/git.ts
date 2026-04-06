import { ipcMain } from "electron";
import { getGitService, getProjectsService, getSettingsService } from "../services";

/**
 * Lightweight LLM call for commit message generation.
 * Uses the cheapest model via Anthropic API with the project's API key.
 */
async function callLightLlm(prompt: string, systemPrompt: string): Promise<string> {
  const settings = getSettingsService()?.getAll();
  const apiKey = settings?.llmApiKey;
  if (!apiKey) throw new Error("No API key configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error("Empty LLM response");
  return text;
}

/** Helper: resolve project path from token */
async function resolveProjectPath(projectToken: string): Promise<string | null> {
  const project = await getProjectsService().getByToken(projectToken);
  return project?.path || null;
}

export function registerGitIpc(): void {
  ipcMain.handle("git:has-repo", async (_e, projectToken: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) return false;
    return getGitService().hasRepo(path);
  });

  ipcMain.handle("git:diff", async (_e, projectToken: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) return "";
    return getGitService().getDiff(path);
  });

  ipcMain.handle("git:status", async (_e, projectToken: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) return "";
    return getGitService().getStatus(path);
  });

  ipcMain.handle("git:status-parsed", async (_e, projectToken: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) return { changes: [], unversioned: [] };
    return getGitService().getStatusParsed(path);
  });

  ipcMain.handle("git:generate-message", async (_e, projectToken: string, taskText: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) throw new Error("Project has no path");
    const git = getGitService();
    const diff = await git.getDiff(path);
    const message = await git.generateCommitMessage(taskText, diff, callLightLlm);
    return { message, diff, hasChanges: diff.trim().length > 0 };
  });

  ipcMain.handle("git:commit", async (_e, projectToken: string, message: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) throw new Error("Project has no path");
    return getGitService().commit(path, message);
  });

  ipcMain.handle("git:commit-selective", async (_e, projectToken: string, message: string, files: string[]) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) throw new Error("Project has no path");
    return getGitService().commitSelective(path, message, files);
  });

  ipcMain.handle("git:stage-files", async (_e, projectToken: string, files: string[]) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) throw new Error("Project has no path");
    await getGitService().stageFiles(path, files);
  });

  ipcMain.handle("git:rollback-file", async (_e, projectToken: string, filePath: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) throw new Error("Project has no path");
    await getGitService().rollbackFile(path, filePath);
  });

  ipcMain.handle("git:add-to-gitignore", async (_e, projectToken: string, pattern: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) throw new Error("Project has no path");
    await getGitService().addToGitignore(path, pattern);
  });

  ipcMain.handle("git:file-diff", async (_e, projectToken: string, filePath: string) => {
    const path = await resolveProjectPath(projectToken);
    if (!path) return "";
    return getGitService().getFileDiff(path, filePath);
  });
}
