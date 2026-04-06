import { execFile } from "child_process";
import { existsSync, appendFileSync, writeFileSync } from "fs";
import { join, basename, dirname } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────

export interface GitFileEntry {
  status: string;       // "M", "A", "D", "R", "??"
  filePath: string;     // full relative path
  fileName: string;     // basename
  dirPath: string;      // dirname
  isUntracked: boolean; // status === "??"
}

export interface GitStatusResult {
  changes: GitFileEntry[];
  unversioned: GitFileEntry[];
}

// ── Service ───────────────────────────────────────────────────

export class GitService {
  /** Checks if .git directory exists in the project folder */
  async hasRepo(projectPath: string): Promise<boolean> {
    return existsSync(join(projectPath, ".git"));
  }

  /** Gets diff (staged + unstaged), truncated to maxLen characters */
  async getDiff(projectPath: string, maxLen = 4000): Promise<string> {
    const [stagedStat, unstagedStat] = await Promise.all([
      this.exec(projectPath, ["diff", "--cached", "--stat"]),
      this.exec(projectPath, ["diff", "--stat"]),
    ]);
    const [stagedPatch, unstagedPatch] = await Promise.all([
      this.exec(projectPath, ["diff", "--cached"]),
      this.exec(projectPath, ["diff"]),
    ]);
    const combined = [stagedStat, unstagedStat, stagedPatch, unstagedPatch]
      .filter(Boolean)
      .join("\n");
    return combined.slice(0, maxLen);
  }

  /** git status --short */
  async getStatus(projectPath: string): Promise<string> {
    return this.exec(projectPath, ["status", "--short"]);
  }

  /** Parses git status --porcelain into a structured result */
  async getStatusParsed(projectPath: string): Promise<GitStatusResult> {
    const raw = await this.exec(projectPath, ["status", "--porcelain"]);
    const changes: GitFileEntry[] = [];
    const unversioned: GitFileEntry[] = [];

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const xy = line.substring(0, 2);
      let filePath = line.substring(3);
      // Handle renames: "R  old -> new"
      const arrowIdx = filePath.indexOf(" -> ");
      if (arrowIdx !== -1) filePath = filePath.substring(arrowIdx + 4);

      const isUntracked = xy === "??";
      const status = isUntracked ? "??" : xy.replace(/ /g, "").charAt(0) || "M";

      const entry: GitFileEntry = {
        status,
        filePath,
        fileName: basename(filePath),
        dirPath: dirname(filePath) === "." ? "" : dirname(filePath),
        isUntracked,
      };

      if (isUntracked) {
        unversioned.push(entry);
      } else {
        changes.push(entry);
      }
    }

    return { changes, unversioned };
  }

  /** git add -A */
  async stageAll(projectPath: string): Promise<void> {
    await this.exec(projectPath, ["add", "-A"]);
  }

  /** Stages specific files */
  async stageFiles(projectPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.exec(projectPath, ["add", "--", ...files]);
  }

  /** Removes everything from the staging area */
  async unstageAll(projectPath: string): Promise<void> {
    try {
      await this.exec(projectPath, ["reset", "HEAD"]);
    } catch {
      // May fail on initial commit (no HEAD) — ignore
    }
  }

  /** git commit -m "message" */
  async commit(projectPath: string, message: string): Promise<string> {
    await this.stageAll(projectPath);
    return this.exec(projectPath, ["commit", "-m", message]);
  }

  /** Commits only selected files: unstage all → stage selected → commit */
  async commitSelective(projectPath: string, message: string, files: string[]): Promise<string> {
    if (files.length === 0) throw new Error("No files selected for commit");
    await this.unstageAll(projectPath);
    await this.stageFiles(projectPath, files);
    return this.exec(projectPath, ["commit", "-m", message]);
  }

  /** Reverts a file to HEAD */
  async rollbackFile(projectPath: string, filePath: string): Promise<void> {
    await this.exec(projectPath, ["checkout", "--", filePath]);
  }

  /** Adds a pattern to .gitignore */
  async addToGitignore(projectPath: string, pattern: string): Promise<void> {
    const gitignorePath = join(projectPath, ".gitignore");
    if (existsSync(gitignorePath)) {
      appendFileSync(gitignorePath, "\n" + pattern + "\n", "utf-8");
    } else {
      writeFileSync(gitignorePath, pattern + "\n", "utf-8");
    }
  }

  /** Diff for a single file */
  async getFileDiff(projectPath: string, filePath: string, maxLen = 8000): Promise<string> {
    // Try unstaged first, then staged, then show as new file
    let diff = await this.exec(projectPath, ["diff", "--", filePath]);
    if (!diff.trim()) {
      diff = await this.exec(projectPath, ["diff", "--cached", "--", filePath]);
    }
    return diff.slice(0, maxLen);
  }

  /** Generates a commit message via an external LLM function */
  async generateCommitMessage(
    taskText: string,
    diff: string,
    generateFn: (prompt: string, systemPrompt: string) => Promise<string>,
  ): Promise<string> {
    const systemPrompt =
      "You are a commit message generator. Write a concise, conventional commit message based on the completed task and git diff. " +
      "Use format: type(scope): description. Keep it under 72 chars. Answer ONLY with the commit message, nothing else. " +
      "Write in the same language as the task.";

    const userPrompt = diff.trim()
      ? `Task completed: "${taskText}"\n\nGit diff:\n${diff}`
      : `Task completed: "${taskText}"\n\n(No file changes detected)`;

    try {
      const message = await generateFn(userPrompt, systemPrompt);
      return message.trim().replace(/^["']|["']$/g, "");
    } catch {
      return `feat: ${taskText.slice(0, 60)}`;
    }
  }

  private async exec(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      });
      return stdout;
    } catch (err: any) {
      // If there are no changes to commit — not an error
      if (err.code === 1 && args[0] === "commit") {
        return err.stdout || "";
      }
      throw err;
    }
  }
}
