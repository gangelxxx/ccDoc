import { join } from "path";
import { homedir } from "os";

export const CCDOC_DIR = join(homedir(), ".ccdoc");
export const APP_DB_PATH = join(CCDOC_DIR, "app.sqlite");
export const PROJECTS_DIR = join(CCDOC_DIR, "projects");
export const BACKUPS_DIR = join(CCDOC_DIR, "backups");
export const USER_DIR = join(CCDOC_DIR, "user");
export const USER_DB_PATH = join(USER_DIR, "user.sqlite");
export const USER_HISTORY_PATH = join(USER_DIR, "history");
export const USER_TOKEN = "__user__";

export const PROJECT_MARKER_DIR = ".ccdoc";
export const PROJECT_TOKEN_FILE = "project.token";
export const CCDOC_IGNORE_FILE = ".ccdocignore";
export const EXPORT_DOCS_DIR = "docs";

export const SOFT_DELETE_DAYS = 30;

export const TRASH_FOLDER_TITLE = "Trash";
export const TRASH_FOLDER_ICON = "🗑️";
export const TRASH_IDEAS_TITLE = "Deleted ideas";
export const TRASH_IDEAS_ICON = "💡";

/** All known trash folder titles (for finding existing folders after language switch) */
export const TRASH_FOLDER_TITLES = ["Trash", "Корзина"];
/** All known trash idea titles */
export const TRASH_IDEAS_TITLES = ["Deleted ideas", "Удалённые идеи"];
export const APP_SCHEMA_VERSION = 5;
export const PROJECT_SCHEMA_VERSION = 13;

const TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateToken(token: string): void {
  if (!TOKEN_REGEX.test(token)) {
    throw new Error(`Invalid project token: ${token}`);
  }
}

export function projectDbPath(token: string): string {
  validateToken(token);
  return join(PROJECTS_DIR, token, "docs.sqlite");
}

export function projectHistoryPath(token: string): string {
  validateToken(token);
  return join(PROJECTS_DIR, token, "history");
}

export function projectBackupPath(token: string): string {
  validateToken(token);
  return join(BACKUPS_DIR, token);
}

/** Block automatically appended to the end of every plan */
export const PLAN_VERIFICATION_BLOCK = `
---
## ✅ Mandatory result verification

After completing ALL plan steps, perform at least **two verification iterations**. Do NOT report completion until both iterations have passed.

### Iteration 1
1. **Plan compliance:** go through each plan item and verify it has been completed. Flag any skipped or incomplete steps.
2. **Error check:** review the result for errors -- syntax, logic, types, missed edge-cases, incorrect file names/paths/signatures.
3. **Fix:** if discrepancies or errors are found -- fix them.

### Iteration 2
1. **Plan compliance (repeat):** go through each item again -- make sure fixes from iteration 1 did not break anything and all steps are still completed.
2. **Error check (repeat):** review once more for errors -- including code that was modified during fixes.
3. **Fix:** if new issues are found -- fix them and re-verify.
`;

/** Instruction for the executor model system prompt */
export const PLAN_EXECUTOR_INSTRUCTION = `
IMPORTANT: When working with a plan, strictly follow each step. Do not skip items, do not change the order, do not add extras without explicit instruction. Pay attention to details: file names, paths, types, function signatures. After completion — verify the result.
`;

/** Regex to check whether a plan contains a verification step */
export const VERIFICATION_STEP_REGEX = /verif|check.*result/i;
